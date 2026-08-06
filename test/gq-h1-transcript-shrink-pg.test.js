// GQ-H1-a: das Transkript kann seit dropLastAgentTranscript SCHRUMPFEN - vorher wuchs es
// nur. flushTranscript (store/pg.js) haengt INDEX-BASIERT an (DB-Zeile i == transcript[i])
// und hat das Schrumpfen nicht gekannt. Ohne das Abraeumen in dieser Phase waere der Fix
// gegen ein sichtbares Problem ein stiller Datenverlust geworden:
//
//   1. die verworfene Antwort bliebe trotz Entfernung in der DB stehen, und
//   2. danach waere persisted > transcript.length - die Anhaenge-Schleife liefe NIE wieder,
//      jedes weitere Segment dieses Calls ginge still verloren.
//
// Punkt 2 ist der gefaehrlichere: er trifft nicht die verworfene Antwort, sondern alles,
// was danach im Gespraech noch gesagt wird. Deshalb ein eigener Test gegen echtes Postgres
// (pglite, kein Netz) MIT Re-Hydrierung - nur so ist die Persistenz belegt und nicht der
// In-Memory-Spiegel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "./pg-helpers.js";

// Frischer Store auf DERSELBEN pglite-Instanz: liest den Spiegel aus der DB neu auf, damit
// die Pruefung die Persistenz trifft und nicht den Speicher (Muster aus store-pg.test.js).
async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

function seedCall(store) {
  return store.createCall({
    direction: "outbound",
    from: "+4915100000000",
    to: "+4915111111111",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
}

// save() ist fire-and-forget UND wird zusammengefasst: ohne ein erzwungenes Flush zwischen
// Schreiben und Verwerfen erreicht der Zwischenstand die DB nie, und der Test misst den
// Defekt nicht (er war so in beiden Faellen gruen). Live liegen zwischen der geschriebenen
// Antwort und ihrem Verwerfen Sekunden und mindestens ein Flush - genau das stellt
// persistiere() her.
// Erzwingt den Flush-Zustand, den es live zwischen zwei Shim-Requests gibt.
async function persistiere(store) {
  await store.save();
}

async function transcriptAusDb(store, db, callId) {
  await store.save();
  const rows = await db.query(
    `SELECT role, text FROM transcript_segment WHERE call_id=$1 ORDER BY id ASC`,
    [callId],
  );
  return rows.rows.map((r) => `${r.role}:${r.text}`);
}

test("GQ-H1-PG-1: die entfernte agent-Zeile verschwindet auch aus der DB", async () => {
  const { store, db } = await makePgTestStore();
  const call = seedCall(store);
  store.addTranscript(call.id, "caller", "Was wuerde ich das wissen?");
  store.addTranscript(call.id, "agent", "nie gesprochen");
  await persistiere(store); // die Antwort steht jetzt WIRKLICH in der DB

  store.dropLastAgentTranscript(call.id);

  assert.deepEqual(await transcriptAusDb(store, db, call.id), ["caller:Was wuerde ich das wissen?"]);
});

test("GQ-H1-PG-2: nach einer Entfernung landen FOLGENDE Segmente weiterhin in der DB", async () => {
  // Der stille Datenverlust: ohne das Abraeumen bliebe persisted (2) > length (1), die
  // Anhaenge-Schleife liefe nie wieder, und alles Weitere dieses Gespraechs waere nur noch
  // im Speicher - bis zum naechsten Deploy.
  const { store, db } = await makePgTestStore();
  const call = seedCall(store);
  store.addTranscript(call.id, "caller", "Was wuerde ich das wissen?");
  store.addTranscript(call.id, "agent", "nie gesprochen");
  await persistiere(store);
  store.dropLastAgentTranscript(call.id);

  store.addTranscript(call.id, "caller", "Was wuerde ich das wissen? Das musst Du wissen.");
  store.addTranscript(call.id, "agent", "die echte Antwort");

  assert.deepEqual(await transcriptAusDb(store, db, call.id), [
    "caller:Was wuerde ich das wissen?",
    "caller:Was wuerde ich das wissen? Das musst Du wissen.",
    "agent:die echte Antwort",
  ]);
});

test("GQ-H1-PG-3: der Stand ueberlebt die Re-Hydrierung (Persistenz, nicht Spiegel)", async () => {
  const { store, db } = await makePgTestStore();
  const call = seedCall(store);
  store.addTranscript(call.id, "caller", "Fragment");
  store.addTranscript(call.id, "agent", "nie gesprochen");
  await persistiere(store);
  store.dropLastAgentTranscript(call.id);
  store.addTranscript(call.id, "agent", "die echte Antwort");

  await store.save();
  const frisch = await reopen(db);
  assert.deepEqual(
    frisch.getCall(call.id).transcript.map((t) => `${t.role}:${t.text}`),
    ["caller:Fragment", "agent:die echte Antwort"],
  );
});

test("GQ-H1-PG-4: dropLastAgentTranscript ruehrt eine abschliessende caller-Zeile nicht an", async () => {
  // Fail-safe-Richtung (G3/T5): lieber eine Zeile zu viel im Transkript als eine echte,
  // gesprochene Aeusserung geloescht.
  const { store, db } = await makePgTestStore();
  const call = seedCall(store);
  store.addTranscript(call.id, "agent", "gesprochen");
  store.addTranscript(call.id, "caller", "und die Gegenstelle antwortet");

  store.dropLastAgentTranscript(call.id);

  assert.deepEqual(await transcriptAusDb(store, db, call.id), [
    "agent:gesprochen",
    "caller:und die Gegenstelle antwortet",
  ]);
});

test("GQ-H1-PG-5: leeres Transkript und unbekannter Call bleiben folgenlos", async () => {
  const { store, db } = await makePgTestStore();
  const call = seedCall(store);

  store.dropLastAgentTranscript(call.id);
  store.dropLastAgentTranscript("call_gibtsnicht");

  assert.deepEqual(await transcriptAusDb(store, db, call.id), []);
  assert.deepEqual(store.getCall(call.id).transcript, []);
});

test("GQ-H1-PG-6: die Entfernung trifft NUR den eigenen Call", async () => {
  const { store, db } = await makePgTestStore();
  const einer = seedCall(store);
  const anderer = seedCall(store);
  store.addTranscript(einer.id, "agent", "meine Antwort");
  store.addTranscript(anderer.id, "agent", "fremde Antwort");
  await persistiere(store);

  store.dropLastAgentTranscript(einer.id);

  assert.deepEqual(await transcriptAusDb(store, db, einer.id), []);
  assert.deepEqual(await transcriptAusDb(store, db, anderer.id), ["agent:fremde Antwort"]);
});

// Gegenprobe zur Fassade (Muster der Re-Export-Kommentare in src/store.js): das json-
// Backend muss dieselbe Operation anbieten, sonst wirft der Shim je nach STORE_BACKEND.
test("GQ-H1-PG-7: beide Backends bieten dropLastAgentTranscript an", async () => {
  const { store } = await makePgTestStore();
  const json = await import("../src/store/json.js");
  assert.equal(typeof store.dropLastAgentTranscript, "function");
  assert.equal(typeof json.dropLastAgentTranscript, "function");
});

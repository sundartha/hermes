import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "./pg-helpers.js";

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

function schrumpfeSpiegel(store, callId) {
  store.getCall(callId).transcript.pop();
}

test("GQ-H1-PG-1: eine am Spiegel entfernte Zeile verschwindet auch aus der DB", async () => {
  const { store, db } = await makePgTestStore();
  const call = seedCall(store);
  store.addTranscript(call.id, "caller", "Was wuerde ich das wissen?");
  store.addTranscript(call.id, "agent", "nie gesprochen");
  await persistiere(store);

  schrumpfeSpiegel(store, call.id);

  assert.deepEqual(await transcriptAusDb(store, db, call.id), ["caller:Was wuerde ich das wissen?"]);
});

test("GQ-H1-PG-2: nach einem Schrumpfen landen FOLGENDE Segmente weiterhin in der DB", async () => {
  const { store, db } = await makePgTestStore();
  const call = seedCall(store);
  store.addTranscript(call.id, "caller", "Was wuerde ich das wissen?");
  store.addTranscript(call.id, "agent", "nie gesprochen");
  await persistiere(store);
  schrumpfeSpiegel(store, call.id);

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
  schrumpfeSpiegel(store, call.id);
  store.addTranscript(call.id, "agent", "die echte Antwort");

  await store.save();
  const frisch = await reopen(db);
  assert.deepEqual(
    frisch.getCall(call.id).transcript.map((t) => `${t.role}:${t.text}`),
    ["caller:Fragment", "agent:die echte Antwort"],
  );
});

test("GQ-H1-PG-6: die Entfernung trifft NUR den eigenen Call", async () => {
  const { store, db } = await makePgTestStore();
  const einer = seedCall(store);
  const anderer = seedCall(store);
  store.addTranscript(einer.id, "agent", "meine Antwort");
  store.addTranscript(anderer.id, "agent", "fremde Antwort");
  await persistiere(store);

  schrumpfeSpiegel(store, einer.id);

  assert.deepEqual(await transcriptAusDb(store, db, einer.id), []);
  assert.deepEqual(await transcriptAusDb(store, db, anderer.id), ["agent:fremde Antwort"]);
});

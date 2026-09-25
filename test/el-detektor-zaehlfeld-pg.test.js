// ST3 (O3): pg-Roundtrip des Detektor-Zaehlfelds (el_detector_counts JSONB).
//
// EIGENE Datei (Repo-Regel p6a): pglite duerfen nicht in Server-Spawn-Dateien stehen -
// Muster test/al-p13-consult-persist-pg.test.js.
//
// KERN-RISIKO (Lehre i8-design-decisions / al-p13): das Zaehlfeld entsteht NACH dem
// Create am Gespraechsende (persistProviderResult). Zwei Fehlerklassen wuerden es
// verlieren: (a) Hydrierung in rowToCall fehlt -> nach dem Restart weg UND der naechste
// Flush schriebe NULL zurueck; (b) el_detector_counts fehlt im ON CONFLICT DO UPDATE
// SET -> der WERT kommt nie in die DB, weil der Create-INSERT ihn als NULL anlegt und
// jede weitere flushende Verbindung nur noch UPDATET. Der Reopen-Beweis deckt beide.
//
// DATA_DIR wird VOR den store-Imports gebunden (Muster al-p13-consult-persist-pg).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let makePgStore, PGlite, BOOTSTRAP, publicCall;

before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-el-detektor-pg-"));
  await import("../src/config.js");
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP } = await import("../src/store/defaults.js"));
  ({ publicCall } = await import("../src/store/views.js"));
});

// pglite-Store hinter dem Runner-Vertrag (Muster al-p13: dieselbe PGlite-Instanz fuer
// beide makePgStore-Aufrufe, damit der Reopen wirklich aus der DB liest).
async function makePgTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (statement, parameter) => db.query(statement, parameter), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner };
}

const neuerAnruf = () => ({
  direction: "outbound",
  from: "+4930111222333",
  to: "+4915112345678",
  goal: "Detektor-Zaehlfeld-Roundtrip",
  tenantId: BOOTSTRAP,
});

test("ST3-pg: elDetectorCounts ueberlebt flush + Reopen, ist set-once und faellt bei spaeteren Flushes nicht auf NULL zurueck", async () => {
  const { store, runner } = await makePgTestStore();
  const call = store.createCall(neuerAnruf());
  assert.equal(call.elDetectorCounts, null, "createCall -> null (json-Parity, kein Feld gesetzt)");

  // Der Normalfall zaehlt mit: {elTags:0, elB1:0} ist ein truthy Objekt und wird gesetzt.
  store.recordElDetectorCounts(call.id, { elTags: 1, elB1: 0 });
  assert.deepEqual(store.getCall(call.id).elDetectorCounts, { elTags: 1, elB1: 0 });

  // Set-once (Owner-Entscheidung 6): ein wiederholter Ergebnisabruf desselben Gespraechs
  // ueberschreibt die erste Zaehlung nicht.
  store.recordElDetectorCounts(call.id, { elTags: 9, elB1: 9 });
  assert.deepEqual(store.getCall(call.id).elDetectorCounts, { elTags: 1, elB1: 0 });

  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.deepEqual(
    reopened.getCall(call.id).elDetectorCounts,
    { elTags: 1, elB1: 0 },
    "das Zaehlfeld MUSS hydriert werden UND im ON CONFLICT DO UPDATE SET stehen - sonst ist es nach dem Restart weg",
  );

  // ON-CONFLICT-SET-Beweis zweiter Ordnung (Lehre al-p13): ein Spaeter-Flush nach einer
  // Mutation eines ANDEREN Call-Feldes darf das Zaehlfeld nicht auf NULL zurueckwerfen.
  reopened.recordFailureReason(call.id, "unreachable:probe");
  await reopened.save();
  const dritter = makePgStore(runner);
  await dritter.init();
  assert.deepEqual(
    dritter.getCall(call.id).elDetectorCounts,
    { elTags: 1, elB1: 0 },
    "ein Flush nach einer Fremd-Mutation hat das Zaehlfeld verworfen",
  );
  assert.equal(dritter.getCall(call.id).failureReason, "unreachable:probe", "Positivkontrolle: die Fremd-Mutation selbst ist da");
});

// ---- Sichtbarkeit (Pin-Test, S1-2 des dualen Reviews) ---------------------------------
// publicCall ist eine SPERRliste: wer dort genannt wird, wird gestrichen. Das Zaehlfeld
// ist Betreiber-Diagnose (PII-frei, aber es beantwortet keine Nutzerfrage) und darf
// /api/state nicht verlassen (Muster costProfile). Der Strip ist Verhalten, also gepinnt
// (Muster AL-P1-5 in al-p1-store-fields.test.js und der Sichtbarkeits-Fall in
// el-sip-call-id-join.test.js); ein Kontrollwert reist mit, damit der Test nicht auch
// dann gruen bliebe, wenn publicCall jemals ALLES streichen wuerde.
test("ST3: publicCall streicht elDetectorCounts - Kontrollwerte reisen mit", () => {
  const sicht = publicCall({
    id: "call_strip_beweis",
    status: "completed",
    elDetectorCounts: { elTags: 4, elB1: 0 },
  });
  assert.equal(sicht.elDetectorCounts, undefined, "das Zaehlfeld darf die API nicht verlassen");
  assert.equal(sicht.id, "call_strip_beweis", "unbeteiligte Felder bleiben erhalten");
  assert.equal(sicht.status, "completed", "unbeteiligte Felder bleiben erhalten");
});

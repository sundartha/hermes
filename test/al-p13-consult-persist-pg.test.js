// AL-P13: pg-Haelfte der Persistenz-Paritaet der Consult-Kette.
//
// EIGENE Datei (Repo-Regel p6a): pglite und Server-Spawn duerfen nicht in derselben
// Datei stehen - test/al-p13-consult-channel.test.js braucht den Spawn fuer den
// Master-Schalter-AUS-Beweis, dieser Lauf braucht pglite.
//
// KERN-RISIKO (Lehre i8-design-decisions): ohne JSONB-Spalte + flush UND rowToCall-
// Hydrierung ginge die Kette beim Restart verloren - und der naechste Flush schriebe
// NULL zurueck. ZUSAETZLICH gilt das ab dieser Phase auch fuer `context`: es ist NICHT
// mehr nach dem Create unveraenderlich (answerConsult merged in context.key_facts).
// Ohne context=EXCLUDED.context im ON CONFLICT DO UPDATE SET faellt jede beantwortete
// Rueckfrage beim naechsten Flush lautlos auf den Create-Zustand zurueck.
//
// DATA_DIR wird VOR den store-Imports gebunden (Muster assistant-context-persist-pg).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const QUESTIONS = ["Wie heisst der Hund?", "Ab wann darf der Termin sein?"];
const ANSWER = "Bello";

let makePgStore, PGlite, BOOTSTRAP, CONSULT_STATUS, CONSULT_ANSWER;

before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-al-p13-pg-"));
  await import("../src/config.js");
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({
    BOOTSTRAP_TENANT_ID: BOOTSTRAP,
    CONSULT_STATUS,
    CONSULT_ANSWER,
  } = await import("../src/store/defaults.js"));
});

// pglite-Store hinter dem Runner-Vertrag (inline wegen der DATA_DIR-Bindungsreihenfolge).
async function makePgTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner };
}

const newCall = () => ({
  direction: "outbound",
  from: "+4930111222333",
  to: "+4915112345678",
  tenantId: BOOTSTRAP,
});

test("AL-P13-PG1: consults UND ein nach dem Create mutiertes context ueberleben den Reopen", async () => {
  const { store, runner } = await makePgTestStore();
  const call = store.createCall(newCall());
  assert.equal(call.consults, null, "createCall -> null (json-Parity)");

  store.emitConsult(call.id, QUESTIONS);
  const answered = store.answerConsult(call.id, { eventId: "c0", facts: [ANSWER] });
  assert.equal(answered.outcome, CONSULT_ANSWER.ACCEPTED);
  await store.save();

  const reopened = makePgStore(runner);
  await reopened.init();
  const hydrated = reopened.getCall(call.id);
  assert.equal(hydrated.consults[0].id, "c0");
  assert.equal(hydrated.consults[0].status, CONSULT_STATUS.ANSWERED);
  assert.deepEqual(hydrated.consults[0].questions, QUESTIONS);
  assert.deepEqual(
    hydrated.context.key_facts,
    [ANSWER],
    "context MUSS im ON CONFLICT DO UPDATE SET stehen - sonst faellt die Antwort auf NULL",
  );
});

test("AL-P13-PG2: ohne Consult bleibt die Spalte NULL und hydriert als null", async () => {
  const { store, runner } = await makePgTestStore();
  const call = store.createCall(newCall());
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(reopened.getCall(call.id).consults, null, "NULL -> null (json-Parity)");
});

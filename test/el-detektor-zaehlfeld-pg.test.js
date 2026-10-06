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

  store.recordElDetectorCounts(call.id, { elTags: 1, elB1: 0 });
  assert.deepEqual(store.getCall(call.id).elDetectorCounts, { elTags: 1, elB1: 0 });

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

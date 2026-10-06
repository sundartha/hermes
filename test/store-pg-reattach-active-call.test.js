import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";

async function sharedDb() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (s) => db.exec(s) }),
  };
  return { db, runner };
}

const outboundCall = () => ({
  direction: "outbound",
  from: "+49",
  to: "+49",
  tenantId: BOOTSTRAP_TENANT_ID,
});

const FOREIGN_CCID = "cc_foreign_1";

async function seedForeignActiveCall(runner) {
  const store1 = makePgStore(runner);
  await store1.init();
  const foreign = store1.createCall(outboundCall());
  foreign.callControlId = FOREIGN_CCID;
  store1.markAnswered(foreign.id);
  await store1.save();
  return foreign.id;
}

test("F12: unbekannter, aber aktiver Call wird re-attached und danach von getCall gefunden", async () => {
  const { runner } = await sharedDb();
  const store2 = makePgStore(runner);
  await store2.init();
  const foreignId = await seedForeignActiveCall(runner);

  assert.equal(store2.getCall(foreignId), null, "vor dem Re-Attach im Spiegel unbekannt");

  const attached = await store2.attachActiveCall(foreignId);
  assert.ok(attached, "attachActiveCall liefert die aktive Zeile");
  assert.equal(attached.id, foreignId);
  assert.equal(attached.status, "active");

  assert.ok(store2.getCall(foreignId), "nach dem Re-Attach im Spiegel gefunden (idempotenter push)");
});

test("F12 fail-closed: unbekannte id -> null, completed-Call -> null", async () => {
  const { runner } = await sharedDb();
  const store2 = makePgStore(runner);
  await store2.init();

  assert.equal(await store2.attachActiveCall("call_does_not_exist"), null, "unbekannte id -> null");

  const store1 = makePgStore(runner);
  await store1.init();
  const done = store1.createCall(outboundCall());
  store1.endCallRecord(done.id, "completed");
  await store1.save();

  assert.equal(await store2.attachActiveCall(done.id), null, "completed-Call -> null (nur status='active')");
  assert.equal(store2.getCall(done.id), null, "fail-closed: kein push eines nicht-aktiven Calls");
});

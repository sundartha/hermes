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

async function withTenantContext(db, tenantId, fn) {
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
  return fn();
}

async function seedForeignActiveCall(runner, { withTranscript = false } = {}) {
  const store1 = makePgStore(runner);
  await store1.init();
  const foreign = store1.createCall(outboundCall());
  store1.markAnswered(foreign.id);
  if (withTranscript) {
    store1.addTranscript(foreign.id, "caller", "Hallo");
  }
  await store1.save();
  return foreign;
}

async function statusInDb(db, callId) {
  return withTenantContext(db, BOOTSTRAP_TENANT_ID, async () =>
    (await db.query(`SELECT id, status FROM call WHERE id=$1`, [callId])).rows,
  );
}

async function transcriptSegmentsInDb(db, callId) {
  return withTenantContext(db, BOOTSTRAP_TENANT_ID, async () =>
    (await db.query(`SELECT id FROM transcript_segment WHERE call_id=$1`, [callId])).rows,
  );
}

test("F8: fremde aktive Zeile ueberlebt Flush mit nicht-leerem Call-Spiegel", async () => {
  const { db, runner } = await sharedDb();
  const store2 = makePgStore(runner);
  await store2.init();
  const foreign = await seedForeignActiveCall(runner);

  store2.createCall(outboundCall());
  await store2.save();

  const rows = await statusInDb(db, foreign.id);
  assert.equal(rows.length, 1, "fremde aktive Zeile ueberlebt den divergenten Flush");
  assert.equal(rows[0].status, "active");
});

test("F8: fremde aktive Zeile ueberlebt Flush mit leerem Call-Spiegel", async () => {
  const { db, runner } = await sharedDb();
  const store2 = makePgStore(runner);
  await store2.init();
  const foreign = await seedForeignActiveCall(runner);

  await store2.save();

  const rows = await statusInDb(db, foreign.id);
  assert.equal(rows.length, 1, "leerer Spiegel loescht die aktive Zeile nicht");
  assert.equal(rows[0].status, "active");
});

test("stab-p10 (I8-CASCADE-Schutz): aktiver Call + transcript_segment ueberleben divergenten Flush; Rehydrat traegt tenantId", async () => {
  const { db, runner } = await sharedDb();
  const foreign = await seedForeignActiveCall(runner, { withTranscript: true });

  const store2 = makePgStore(runner);
  await store2.init();
  store2.createCall(outboundCall());
  await store2.save();

  const rows = await statusInDb(db, foreign.id);
  assert.equal(rows.length, 1, "fremde aktive Zeile ueberlebt den divergenten Flush");
  assert.equal(rows[0].status, "active");

  const segs = await transcriptSegmentsInDb(db, foreign.id);
  assert.equal(segs.length, 1, "transcript_segment ueberlebt (kein CASCADE-Delete)");

  const attached = await store2.attachActiveCall(foreign.id);
  assert.equal(attached.tenantId, BOOTSTRAP_TENANT_ID, "I8: tenantId hydriert");
  assert.equal(attached.transcript.length, 1);
});

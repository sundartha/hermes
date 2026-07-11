// F8 (A6/DEPLOY-04): der Reconcile-Flush (pg.js flushCalls) darf eine FREMDE aktive
// Call-Zeile NIE loeschen, wenn der flushende Prozess sie nicht im Spiegel hat.
// Zwei Stores auf EINER pglite-DB = zwei Prozesse mit divergentem In-Memory-Spiegel.
// Pglite (offline, F.I.R.S.T.); KEIN Server-Spawn in dieser Datei (p6a-Regel).
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

async function seedForeignActiveCall(runner) {
  // store1 legt auf DERSELBEN DB einen aktiven Call an, den store2 nie im Spiegel sah.
  const store1 = makePgStore(runner);
  await store1.init();
  const foreign = store1.createCall(outboundCall());
  store1.markAnswered(foreign.id);
  await store1.save(); // aktive Zeile jetzt in der DB (status=active)
  return foreign.id;
}

async function statusInDb(db, callId) {
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  return (await db.query(`SELECT id, status FROM call WHERE id=$1`, [callId])).rows;
}

test("F8: fremde aktive Zeile ueberlebt Flush mit nicht-leerem Call-Spiegel", async () => {
  const { db, runner } = await sharedDb();
  const store2 = makePgStore(runner);
  await store2.init(); // leerer Spiegel (kennt den Fremd-Call nicht)
  const foreignId = await seedForeignActiveCall(runner);

  // store2 flusht seinen eigenen Call -> deleteMissingCallsKeepActive, keepIds=[eigener]
  store2.createCall(outboundCall());
  await store2.save();

  const rows = await statusInDb(db, foreignId);
  assert.equal(rows.length, 1, "fremde aktive Zeile ueberlebt den divergenten Flush");
  assert.equal(rows[0].status, "active");
});

test("F8: fremde aktive Zeile ueberlebt Flush mit leerem Call-Spiegel", async () => {
  const { db, runner } = await sharedDb();
  const store2 = makePgStore(runner);
  await store2.init(); // leerer Spiegel, bleibt call-leer
  const foreignId = await seedForeignActiveCall(runner);

  await store2.save(); // flushCalls(BOOTSTRAP, []) -> leerer keepIds-Zweig

  const rows = await statusInDb(db, foreignId);
  assert.equal(rows.length, 1, "leerer Spiegel loescht die aktive Zeile nicht");
  assert.equal(rows[0].status, "active");
});

// stab-p10 (I8-CASCADE-Schutz): der F8-Test oben beweist nur "Call-Row ueberlebt". Diese
// Ergaenzung nagelt die von der Spec explizit verlangte CASCADE-Kernaussage fest:
// transcript_segment (FK ON DELETE CASCADE auf call) darf beim divergenten Flush NICHT
// mitgeloescht werden, UND ein spaeteres attachActiveCall (Rehydrate, F12/A6) muss die
// tenantId korrekt hydrieren (I8) - sonst faende der Owner-Filter nach dem Flush keinen
// Call mehr und loeschte beim naechsten Zyklus fälschlich alles.
test("stab-p10 (I8-CASCADE-Schutz): aktiver Call + transcript_segment ueberleben divergenten Flush; Rehydrat traegt tenantId", async () => {
  const { db, runner } = await sharedDb();
  const store1 = makePgStore(runner);
  await store1.init();
  const foreign = store1.createCall(outboundCall());
  store1.markAnswered(foreign.id);
  store1.addTranscript(foreign.id, "caller", "Hallo");
  await store1.save(); // aktive Zeile + Transkript-Segment jetzt in der DB

  const store2 = makePgStore(runner);
  await store2.init(); // leerer Spiegel (kennt den Fremd-Call nicht)
  store2.createCall(outboundCall());
  await store2.save(); // divergenter Flush -> deleteMissingCallsKeepActive

  const rows = await statusInDb(db, foreign.id);
  assert.equal(rows.length, 1, "fremde aktive Zeile ueberlebt den divergenten Flush");
  assert.equal(rows[0].status, "active");

  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  const segs = (await db.query(`SELECT id FROM transcript_segment WHERE call_id=$1`, [foreign.id])).rows;
  assert.equal(segs.length, 1, "transcript_segment ueberlebt (kein CASCADE-Delete)");

  const attached = await store2.attachActiveCall(foreign.id);
  assert.equal(attached.tenantId, BOOTSTRAP_TENANT_ID, "I8: tenantId hydriert");
  assert.equal(attached.transcript.length, 1);
});

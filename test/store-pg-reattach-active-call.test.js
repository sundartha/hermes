// F12 (A6/DEPLOY-04): store.attachActiveCall holt einen dem Spiegel unbekannten, aber in
// der DB aktiven Call RLS-sauber zurueck (Deploy-Instanzwechsel: eine andere Instanz legte
// die aktive Zeile NACH unserer Hydrierung an). Zwei Stores auf EINER pglite-DB = zwei
// Prozesse mit divergentem In-Memory-Spiegel. Fail-closed: unbekannte id -> null,
// completed-Call -> null (Query filtert status='active'). Pglite (offline, F.I.R.S.T.);
// KEIN Server-Spawn in dieser Datei (p6a-Regel: pglite + Spawn nie mischen).
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

// KS-P1b: die Telnyx-eigene call_control_id des geseedeten Fremd-Calls (der Shim korreliert
// NUR darueber, E1).
const FOREIGN_CCID = "cc_foreign_1";

// store1 legt auf DERSELBEN DB einen aktiven Call an, den store2 nie im Spiegel sah.
// KS-P1b: mit gesetzter call_control_id - genau wie in Prod (telnyx-origination.js/
// telnyx-inbound.js mutieren call.callControlId und flushen ueber save()).
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
  await store2.init(); // leerer Spiegel (kennt den Fremd-Call nicht)
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
  await store2.init(); // leerer Spiegel

  assert.equal(await store2.attachActiveCall("call_does_not_exist"), null, "unbekannte id -> null");

  // store1 legt einen COMPLETED Call an (nie aktiv im Spiegel von store2).
  const store1 = makePgStore(runner);
  await store1.init();
  const done = store1.createCall(outboundCall());
  store1.endCallRecord(done.id, "completed");
  await store1.save();

  assert.equal(await store2.attachActiveCall(done.id), null, "completed-Call -> null (nur status='active')");
  assert.equal(store2.getCall(done.id), null, "fail-closed: kein push eines nicht-aktiven Calls");
});

// KS-P1b-9/KS-P1b-10 (Nachladung ueber die call_control_id, Assistant-Shim) sind mit
// IE6-S1 entfernt - getCallByControlId/attachActiveCallByControlId existieren nicht mehr.

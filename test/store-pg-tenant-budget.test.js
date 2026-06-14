// P4: Budget/Usage tenant-scoped (Daten-Schicht pro-Tenant). Prueft die GENUINE
// pro-Tenant-Datenschicht auf STATE-OPS-Ebene (ops.usageFor/trackUsage/
// budgetExceeded/globalBudgetExceeded/countOutboundCallsSince) mit zwei
// synthetischen Tenants - nicht die owner-scoped pg-Hydrierung (die bleibt ein
// Key, P4-Scope-Grenze). Der Spiegel wird per ops direkt manipuliert (wie der
// pruneOldData-Test alte Daten direkt im Spiegel seedet). Test 5 belegt die
// zweite Verteidigungslinie (RLS) auch fuer die usage-Tabelle. pglite = kein
// Netz, keine externe DB (F.I.R.S.T.).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, OWNER_TENANT_ID } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";
import * as ops from "../src/store/state-ops.js";

const PRICES = { priceInPerMTokUsd: 1.0, priceOutPerMTokUsd: 5.0, usdToEur: 0.93, maxBudgetEur: 8 };
const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";
const APP_ROLE = "app_user"; // liest Owner-Daten, ohne Superuser/BYPASSRLS

// Token-Menge, die unter PRICES (Input 1 USD/MTok, * 0.93) den 8-EUR-Cap reisst.
const TOKENS_OVER_CAP = 10_000_000; // 10 USD * 0.93 = 9.3 EUR > 8

test("P4 Test 1: Pro-Tenant-Budget-Isolation (A ueber Cap, B unberuehrt)", async () => {
  const { store } = await makePgTestStore();
  const s = store.load();
  ops.trackUsage(s, TENANT_A, TOKENS_OVER_CAP, 0, PRICES);
  assert.equal(ops.budgetExceeded(s, TENANT_A, PRICES), true, "A hat den Cap gerissen");
  assert.equal(ops.budgetExceeded(s, TENANT_B, PRICES), false, "B ist frei");
  assert.equal(ops.usageFor(s, TENANT_B).costEur, 0, "B-Bucket ist null");
});

test("P4 Test 2: trackUsage(A) beeinflusst B nicht (frischer Null-Bucket)", async () => {
  const { store } = await makePgTestStore();
  const s = store.load();
  ops.trackUsage(s, TENANT_A, 1_000_000, 1_000_000, PRICES);
  const bucketB = ops.usageFor(s, TENANT_B);
  assert.deepEqual(bucketB, { inputTokens: 0, outputTokens: 0, costEur: 0, calls: 0 });
});

test("P4 Test 3: globaler Notaus greift, waehrend jeder Tenant unter seinem Cap bleibt", async () => {
  const { store } = await makePgTestStore();
  const s = store.load();
  // Je 6 USD * 0.93 = 5.58 EUR pro Tenant -> unter 8, Summe 11.16 EUR -> ueber 8.
  ops.trackUsage(s, TENANT_A, 6_000_000, 0, PRICES);
  ops.trackUsage(s, TENANT_B, 6_000_000, 0, PRICES);
  assert.equal(ops.budgetExceeded(s, TENANT_A, PRICES), false, "A einzeln unter Cap");
  assert.equal(ops.budgetExceeded(s, TENANT_B, PRICES), false, "B einzeln unter Cap");
  assert.equal(ops.globalBudgetExceeded(s, PRICES), true, "Plattform-Summe ueber Cap");
});

test("P4 Test 4: countOutboundCallsSince pro-Tenant + pro-Nutzer + global", async () => {
  const { store } = await makePgTestStore();
  const s = store.load();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  ops.createCall(s, { direction: "outbound", from: "+49", to: "+49", tenantId: TENANT_A, requestedBy: "x@a" });
  ops.createCall(s, { direction: "outbound", from: "+49", to: "+49", tenantId: TENANT_A, requestedBy: "y@a" });
  ops.createCall(s, { direction: "outbound", from: "+49", to: "+49", tenantId: TENANT_B, requestedBy: "x@a" });
  ops.createCall(s, { direction: "inbound", from: "+49", to: "+49", tenantId: TENANT_A });
  assert.equal(ops.countOutboundCallsSince(s, since, { tenantId: TENANT_A }), 2, "A-Outbound");
  assert.equal(ops.countOutboundCallsSince(s, since, { tenantId: TENANT_B }), 1, "B-Outbound");
  assert.equal(ops.countOutboundCallsSince(s, since, { requestedBy: "x@a" }), 2, "Nutzer x@a ueber Tenants");
  // Kombiniert (UND): nur x@a-Outbound im Tenant A.
  assert.equal(ops.countOutboundCallsSince(s, since, { tenantId: TENANT_A, requestedBy: "x@a" }), 1);
  assert.equal(ops.countOutboundCallsSince(s, since), 3, "alle Outbound (globale Bremse)");
});

// Baut den Owner-Store (migriert Schema, seedet Owner-usage), seedet zwei fremde
// Tenants mit eigenen usage-Zeilen und legt die unprivilegierte Rolle an. Analog
// store-pg-rls.test.js, hier auf die usage-Tabelle fokussiert.
async function setupUsageRls() {
  const db = new PGlite();
  const runner = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }) };
  const store = makePgStore(runner);
  await store.init(); // migriert + seedet Owner (inkl. Owner-usage-Zeile)

  for (const tenantId of [TENANT_A, TENANT_B]) {
    await db.query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [tenantId]);
    await db.query(
      `INSERT INTO usage (tenant_id, input_tokens, output_tokens, cost_eur, calls)
       VALUES ($1, 100, 200, 3.5, 4)`,
      [tenantId]
    );
  }

  await db.exec(
    `CREATE ROLE ${APP_ROLE} NOLOGIN;
     GRANT SELECT, INSERT, UPDATE, DELETE ON usage TO ${APP_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`
  );
  return db;
}

test("P4 Test 5: usage-Tabelle ist tenant-isoliert (Cross-Tenant-Read = leer, RLS)", async () => {
  const db = await setupUsageRls();
  await db.query(`SET ROLE ${APP_ROLE}`);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [OWNER_TENANT_ID]);
  try {
    const tenantIds = (await db.query(`SELECT tenant_id FROM usage ORDER BY tenant_id`)).rows.map((r) => r.tenant_id);
    assert.deepEqual(tenantIds, [OWNER_TENANT_ID], "nur die Owner-usage-Zeile sichtbar");
    assert.ok(!tenantIds.includes(TENANT_A), "fremde usage-Zeile A unsichtbar");
    assert.ok(!tenantIds.includes(TENANT_B), "fremde usage-Zeile B unsichtbar");
  } finally {
    await db.query(`RESET ROLE`);
  }
});

// P4: Budget/Usage tenant-scoped (Daten-Schicht pro-Tenant). Prueft die GENUINE
// pro-Tenant-Datenschicht auf STATE-OPS-Ebene (ops.usageFor/trackUsage/
// budgetExceeded/globalBudgetExceeded/countOutboundCallsSince) mit zwei
// synthetischen Tenants - nicht die owner-scoped pg-Hydrierung (die bleibt ein
// Key, P4-Scope-Grenze). Der Spiegel wird per ops direkt manipuliert (wie der
// pruneOldData-Test alte Daten direkt im Spiegel seedet). Test 5 belegt die
// zweite Verteidigungslinie (RLS) auch fuer die usage-Tabelle, Test 6/7 (P6b3)
// fuer die neuen tenant_budget/usage_event-Tabellen. pglite = kein Netz, keine
// externe DB (F.I.R.S.T.).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";
import * as ops from "../src/store/state-ops.js";
import { PRICES, tokensOf } from "./_prices.js";

const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";
const APP_ROLE = "app_user"; // liest Owner-Daten, ohne Superuser/BYPASSRLS

// Token-Menge, die unter PRICES (Input 1 USD/MTok, * 0.93) den 8-EUR-Cap reisst.
const TOKENS_OVER_CAP = 10_000_000; // 10 USD * 0.93 = 9.3 EUR > 8

test("P4 Test 1: Pro-Tenant-Budget-Isolation (A ueber Cap, B unberuehrt)", async () => {
  const { store } = await makePgTestStore();
  const s = store.load();
  ops.trackUsage(s, TENANT_A, tokensOf(TOKENS_OVER_CAP, 0), PRICES);
  assert.equal(ops.budgetExceeded(s, TENANT_A, PRICES), true, "A hat den Cap gerissen");
  assert.equal(ops.budgetExceeded(s, TENANT_B, PRICES), false, "B ist frei");
  assert.equal(ops.usageFor(s, TENANT_B).costCents, 0, "B-Bucket ist null");
});

test("P4 Test 2: trackUsage(A) beeinflusst B nicht (frischer Null-Bucket)", async () => {
  const { store } = await makePgTestStore();
  const s = store.load();
  ops.trackUsage(s, TENANT_A, tokensOf(1_000_000, 1_000_000), PRICES);
  const bucketB = ops.usageFor(s, TENANT_B);
  assert.deepEqual(bucketB, {
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    costMicroCentsRem: 0,
    costCorrectionMicroCentsRem: 0, // LCT P4: neues emptyUsage()-Feld
    ttsCharacters: 0, // KE-P6: neues emptyUsage()-Feld
    calls: 0,
    spendMonthKey: null,
    spendMonthCostCents: 0,
  });
});

test("P4 Test 3: globaler Notaus greift, waehrend jeder Tenant unter seinem Cap bleibt", async () => {
  const { store } = await makePgTestStore();
  const s = store.load();
  // Je 6 USD * 0.93 = 5.58 EUR pro Tenant -> unter 8, Summe 11.16 EUR -> ueber 8.
  ops.trackUsage(s, TENANT_A, tokensOf(6_000_000, 0), PRICES);
  ops.trackUsage(s, TENANT_B, tokensOf(6_000_000, 0), PRICES);
  assert.equal(ops.budgetExceeded(s, TENANT_A, PRICES), false, "A einzeln unter Cap");
  assert.equal(ops.budgetExceeded(s, TENANT_B, PRICES), false, "B einzeln unter Cap");
  assert.equal(ops.globalBudgetExceeded(s, PRICES), true, "Plattform-Summe ueber Cap");
});

test("P4 Test 4: countOutboundCallsSince pro-Tenant + pro-Nutzer + global", async () => {
  const { store } = await makePgTestStore();
  const s = store.load();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  ops.createCall(s, {
    direction: "outbound",
    from: "+49",
    to: "+49",
    tenantId: TENANT_A,
    requestedBy: "x@a",
  });
  ops.createCall(s, {
    direction: "outbound",
    from: "+49",
    to: "+49",
    tenantId: TENANT_A,
    requestedBy: "y@a",
  });
  ops.createCall(s, {
    direction: "outbound",
    from: "+49",
    to: "+49",
    tenantId: TENANT_B,
    requestedBy: "x@a",
  });
  ops.createCall(s, { direction: "inbound", from: "+49", to: "+49", tenantId: TENANT_A });
  assert.equal(ops.countOutboundCallsSince(s, since, { tenantId: TENANT_A }), 2, "A-Outbound");
  assert.equal(ops.countOutboundCallsSince(s, since, { tenantId: TENANT_B }), 1, "B-Outbound");
  assert.equal(
    ops.countOutboundCallsSince(s, since, { requestedBy: "x@a" }),
    2,
    "Nutzer x@a ueber Tenants",
  );
  // Kombiniert (UND): nur x@a-Outbound im Tenant A.
  assert.equal(
    ops.countOutboundCallsSince(s, since, { tenantId: TENANT_A, requestedBy: "x@a" }),
    1,
  );
  assert.equal(ops.countOutboundCallsSince(s, since), 3, "alle Outbound (globale Bremse)");
});

test("outbound-p1d: countOutboundCallsSince mit to-Filter -> per-(Tenant,Ziel) isoliert", async () => {
  const { store } = await makePgTestStore();
  const s = store.load();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const VICTIM = "+4915112345678";
  const OTHER = "+4915199999999";
  for (let i = 0; i < 3; i++)
    ops.createCall(s, {
      direction: "outbound",
      from: "+49",
      to: VICTIM,
      tenantId: TENANT_A,
      requestedBy: "x@a",
    });
  ops.createCall(s, {
    direction: "outbound",
    from: "+49",
    to: OTHER,
    tenantId: TENANT_A,
    requestedBy: "x@a",
  });
  ops.createCall(s, {
    direction: "outbound",
    from: "+49",
    to: VICTIM,
    tenantId: TENANT_B,
    requestedBy: "z@b",
  });

  assert.equal(
    ops.countOutboundCallsSince(s, since, { tenantId: TENANT_A, to: VICTIM }),
    3,
    "A -> Opfer",
  );
  assert.equal(
    ops.countOutboundCallsSince(s, since, { tenantId: TENANT_A, to: OTHER }),
    1,
    "A -> anderes Ziel unberuehrt",
  );
  assert.equal(
    ops.countOutboundCallsSince(s, since, { tenantId: TENANT_B, to: VICTIM }),
    1,
    "B -> Opfer (A erschoepft B NICHT)",
  );
  assert.equal(
    ops.countOutboundCallsSince(s, since, { to: VICTIM }),
    4,
    "to ohne tenantId = alle ans Opfer",
  );
});

// Baut den Owner-Store (migriert Schema, seedet Owner-usage), seedet zwei fremde
// Tenants mit eigenen usage-Zeilen und legt die unprivilegierte Rolle an. Analog
// store-pg-rls.test.js, hier auf die usage-Tabelle fokussiert.
async function setupUsageRls() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init(); // migriert + seedet Owner (inkl. Owner-usage-Zeile)

  for (const tenantId of [TENANT_A, TENANT_B]) {
    await db.query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [tenantId]);
    await db.query(
      `INSERT INTO usage (tenant_id, input_tokens, output_tokens, cost_eur, calls)
       VALUES ($1, 100, 200, 3.5, 4)`,
      [tenantId],
    );
  }

  await db.exec(
    `CREATE ROLE ${APP_ROLE} NOLOGIN;
     GRANT SELECT, INSERT, UPDATE, DELETE ON usage TO ${APP_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`,
  );
  return db;
}

test("P4 Test 5: usage-Tabelle ist tenant-isoliert (Cross-Tenant-Read = leer, RLS)", async () => {
  const db = await setupUsageRls();
  await db.query(`SET ROLE ${APP_ROLE}`);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  try {
    const tenantIds = (await db.query(`SELECT tenant_id FROM usage ORDER BY tenant_id`)).rows.map(
      (r) => r.tenant_id,
    );
    assert.deepEqual(tenantIds, [BOOTSTRAP_TENANT_ID], "nur die Owner-usage-Zeile sichtbar");
    assert.ok(!tenantIds.includes(TENANT_A), "fremde usage-Zeile A unsichtbar");
    assert.ok(!tenantIds.includes(TENANT_B), "fremde usage-Zeile B unsichtbar");
  } finally {
    await db.query(`RESET ROLE`);
  }
});

// P6b3: seedet Owner + zwei fremde Tenants mit eigenen tenant_budget- und
// usage_event-Zeilen unter der jeweiligen RLS-GUC (FORCE-RLS blockt sonst den
// Insert), legt die unprivilegierte Rolle an. Analog setupUsageRls, hier auf die
// zwei neuen P6b3-Tabellen.
async function setupMeterRls() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();

  for (const tenantId of [TENANT_A, TENANT_B]) {
    await db.query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [tenantId]);
    await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
    await db.query(
      `INSERT INTO tenant_budget (tenant_id, budget_cents, hard_cap_cents) VALUES ($1, 400, 500)`,
      [tenantId],
    );
    await db.query(
      `INSERT INTO usage_event (id, tenant_id, call_id, kind, quantity, cost_cents, occurred_at)
       VALUES ($1, $2, NULL, 'number_month', 1, 500, '2026-01-01T00:00:00.000Z')`,
      [`ue_${tenantId}`, tenantId],
    );
  }
  await db.query(`RESET app.current_tenant`);

  await db.exec(
    `CREATE ROLE ${APP_ROLE} NOLOGIN;
     GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_budget TO ${APP_ROLE};
     GRANT SELECT, INSERT, UPDATE, DELETE ON usage_event TO ${APP_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`,
  );
  return db;
}

test("P6b3 Test 6: tenant_budget ist tenant-isoliert (Cross-Tenant-Read = leer, RLS)", async () => {
  const db = await setupMeterRls();
  await db.query(`SET ROLE ${APP_ROLE}`);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [TENANT_A]);
  try {
    const tenantIds = (
      await db.query(`SELECT tenant_id FROM tenant_budget ORDER BY tenant_id`)
    ).rows.map((r) => r.tenant_id);
    assert.deepEqual(tenantIds, [TENANT_A], "nur die eigene tenant_budget-Zeile sichtbar");
    assert.ok(!tenantIds.includes(TENANT_B), "fremde tenant_budget-Zeile B unsichtbar");
    assert.ok(!tenantIds.includes(BOOTSTRAP_TENANT_ID), "Owner-Zeile (falls vorhanden) unsichtbar");
  } finally {
    await db.query(`RESET ROLE`);
  }
});

test("P6b3 Test 7: usage_event ist tenant-isoliert (Cross-Tenant-Read = leer, RLS)", async () => {
  const db = await setupMeterRls();
  await db.query(`SET ROLE ${APP_ROLE}`);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [TENANT_A]);
  try {
    const tenantIds = (
      await db.query(`SELECT tenant_id FROM usage_event ORDER BY tenant_id`)
    ).rows.map((r) => r.tenant_id);
    assert.deepEqual(tenantIds, [TENANT_A], "nur die eigenen usage_event-Zeilen sichtbar");
    assert.ok(!tenantIds.includes(TENANT_B), "fremde usage_event-Zeile B unsichtbar");
  } finally {
    await db.query(`RESET ROLE`);
  }
});

// outbound-p1c (Spec-Test 6, "beide Backends"): die neue Vorab-Reservierung + der
// Budget-Reconcile + der registerTenant-Default-Seed muessen auch ueber die pg-Fassade
// + Persistenz funktionieren. pglite = kein Netz, keine externe DB (F.I.R.S.T.).
test("outbound-p1c Test 8 (pg): reserveExceedsBudget + addVoiceUsageCostCents ueber den Wrapper", async () => {
  const { store } = await makePgTestStore();
  const s = store.load();
  ops.setTenantBudget(s, TENANT_A, { budgetCents: 150, hardCapCents: 150 }); // 1.50 EUR Cap
  assert.equal(store.reserveExceedsBudget(TENANT_A, 1500, PRICES), true, "15 EUR Reserve > 1.50 EUR Cap");
  assert.equal(store.reserveExceedsBudget(TENANT_A, 60, PRICES), false, "0.60 EUR Reserve < 1.50 EUR Cap");
  // Reconcile bucht die Ist-Minuten in den Spiegel-Bucket -> hebt budgetExceeded an.
  store.addVoiceUsageCostCents(TENANT_A, 200); // 2 EUR Ist > 1.50 EUR Cap
  assert.equal(store.budgetExceeded(TENANT_A, PRICES), true, "Ist-Minuten reissen den Cap");
});

test("outbound-p1c Test 9 (pg): tenant_budget-Seed + costCents-Reconcile ueberleben save()->reload", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, "user_x", { firstName: "Max", defaultBudgetCents: 1000 });
  ops.addVoiceUsageCostCents(s, "user_x", 250); // 2.50 EUR Carrier-Minuten
  await store.save();

  // Frischer Store auf DERSELBEN DB -> hydriert aus der DB (kein Spiegel-Reuse).
  const store2 = makePgStore(runner);
  await store2.init();
  const s2 = store2.load();
  assert.deepEqual(
    s2.tenantBudgets.find((b) => b.tenantId === "user_x"),
    { tenantId: "user_x", budgetCents: 1000, hardCapCents: 1000 },
    "tenant_budget-Default-Seed persistiert (flushTenantBudgets)",
  );
  assert.equal(ops.usageFor(s2, "user_x").costCents, 250, "Reconcile-costCents persistiert (flushUsage)");
});

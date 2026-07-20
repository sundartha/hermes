// LCT P6: zweite Linie der Plan-Cap-Ableitung (WARN-Klemme, kein Wurf auf dem
// Geldpfad) + der Nachlese-Guard direkt (tenantCapRowInertFindings). pglite (F.I.R.S.T.).
//
// process.env.MAX_BUDGET_EUR="5" (platformCap=500 ct) < abgeleitete Business-Decke
// (900 ct) - GENAU der Fall, den der Clamp in deriveTenantBudgetFromPlan auffaengt.
// KEIN Server-Boot in dieser Datei (die erste, FATALE Linie greift nur in src/boot.js) -
// nur die Schreibkante (store.setTenantSubscription) wird direkt gerufen. Mechanik gegen
// die Modul-Config-Falle: process.env VOR jedem Import, ausschliesslich dynamische
// Imports in before() (Muster plan-cap-derivation.test.js).
process.env.MAX_BUDGET_EUR = "5";
process.env.VOICE_CAP_RATE_CENTS_PER_MIN = "6";

import test, { before } from "node:test";
import assert from "node:assert/strict";

let PGlite, makePgStore, config, ops, subscribeMod, webhookMod, bootGuardMod;

before(async () => {
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ config } = await import("../src/config.js"));
  ops = await import("../src/store/state-ops.js");
  subscribeMod = await import("../src/billing/subscribe.js");
  webhookMod = await import("../src/billing/webhook.js");
  bootGuardMod = await import("../src/boot-guard.js");
  config.billing.stripeStarterPriceId = "price_starter_test";
  config.billing.stripeBusinessPriceId = "price_business_test";
});

async function makeTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner };
}

// Faengt console.warn waehrend fn() ab (kein Log-Lesen, P12/S). Eigene, minimale Kopie
// statt test/helpers.js-Import: diese Datei bleibt bewusst bei ausschliesslich
// dynamischen Imports (s. Datei-Kommentar oben), ein statischer Helper-Import waere die
// einzige Ausnahme davon.
async function captureWarn(fn) {
  const lines = [];
  const orig = console.warn;
  console.warn = (...a) => lines.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.warn = orig;
  }
  return lines;
}

test("(j2a) applyStripeWebhook ACTIVATE (business) laeuft vollstaendig durch, Decke geklemmt auf 500, genau EINE WARN", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_j2a";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "J2A" });
  // Realistischer Vorzustand des Race-Fix (webhook.js): customerId bereits bekannt
  // (Checkout-Session-Anlage), paymentMethodId noch nicht - NUR dann fuellt der
  // Webhook die Luecke (customerMatches braucht einen VORHANDENEN Treffer).
  store.setTenantStripe(tenantId, { customerId: "cus_j2a" });
  const event = {
    type: webhookMod.SUBSCRIPTION_EVENT.CREATED,
    data: {
      object: {
        id: "sub_j2a",
        status: "active",
        current_period_end: 1893456000,
        current_period_start: 1890864000,
        customer: "cus_j2a",
        default_payment_method: "pm_j2a",
        metadata: { tenant_ref: tenantId, plan_slug: "business" },
      },
    },
  };
  const setStatusCalls = [];
  const provisionCalls = [];
  const warnLines = await captureWarn(() =>
    webhookMod.applyStripeWebhook(event, {
      store,
      accounts: { setStatus: async (t, st) => setStatusCalls.push([t, st]) },
      sessions: { invalidateByTenant: async () => {} },
      audit: () => {},
      req: {},
      provision: async (t) => provisionCalls.push(t),
      billing: undefined,
    }),
  );
  // Voller Durchlauf trotz Clamp (Zahlungspfad NICHT unterbrochen): Perioden-Anker,
  // Karte gebunden, Aktivierung + Provisioning ausgeloest.
  assert.equal(store.tenantSubscription(tenantId).subscriptionId, "sub_j2a");
  assert.equal(store.tenantSubscription(tenantId).currentPeriodEnd, 1893456000);
  assert.equal(store.tenantStripe(tenantId).customerId, "cus_j2a", "Karte via Fake gebunden");
  assert.deepEqual(setStatusCalls, [[tenantId, "active"]]);
  assert.deepEqual(provisionCalls, [tenantId], "Provisioning ausgeloest");
  assert.equal(
    store.tenantBudgetSnapshot(tenantId, config.billing).capCents,
    500,
    "auf platformSpendCapCents geklemmt (900 abgeleitet, 500 Cap)",
  );
  const clampLines = warnLines.filter((l) => l.includes("grund=clamp"));
  assert.equal(clampLines.length, 1, `erwartet genau EINE Klemm-WARN, war:\n${warnLines.join("\n")}`);
  assert.match(clampLines[0], /slug=business/);
  assert.match(clampLines[0], /abgeleitet=900/);
  assert.match(clampLines[0], /platformSpendCapCents=500/);
});

test("(j2b) Checkout-Return-Pfad (business) laeuft vollstaendig durch, Decke geklemmt auf 500, genau EINE WARN", async () => {
  const { store } = await makeTestStore();
  const tenantId = "t_j2b";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "J2B" });
  store.setTenantStripe(tenantId, { customerId: "cus_j2b" }); // Customer-Match
  const outcome = {
    customerId: "cus_j2b",
    paymentMethodId: "pm_j2b",
    subscriptionId: "sub_j2b",
    currentPeriodStart: 1890864000,
    currentPeriodEnd: 1893456000,
    planSlug: "business",
  };
  const provisionCalls = [];
  let result;
  const warnLines = await captureWarn(async () => {
    result = await subscribeMod.activateSubscriptionFromCheckoutSession({
      store,
      billing: { getSubscriptionCheckoutResult: async () => outcome },
      accounts: { setStatus: async () => {} },
      provision: async (t) => provisionCalls.push(t),
      tenant: tenantId,
      sessionId: "cs_j2b",
      expectedPlanSlug: "business",
    });
  });
  assert.equal(result.ok, true, "Checkout-Return-Pfad laeuft vollstaendig durch (kein Wurf)");
  assert.equal(store.tenantStripe(tenantId).paymentMethodId, "pm_j2b", "Karte via Fake gebunden");
  assert.deepEqual(provisionCalls, [tenantId], "Provisioning ausgeloest");
  assert.equal(store.tenantBudgetSnapshot(tenantId, config.billing).capCents, 500, "auf 500 geklemmt");
  const clampLines = warnLines.filter((l) => l.includes("grund=clamp"));
  assert.equal(clampLines.length, 1, `erwartet genau EINE Klemm-WARN, war:\n${warnLines.join("\n")}`);
});

// ---- (j3) Nachlese-Guard direkt (zweite Linie, reine Funktion) ----------------------

test("(j3) tenantCapRowInertFindings: eine gesetzte Zeile >= platformCap -> genau EIN WARN-Finding", () => {
  const findings = bootGuardMod.tenantCapRowInertFindings({
    budgetRows: [{ tenantId: "x", hardCapCents: 900, budgetCents: 900 }],
    platformCapCents: 500,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, false);
  assert.equal(findings[0].code, bootGuardMod.PLAN_CAP_FINDING.TENANT_CAP_ROW_INERT);
  assert.match(findings[0].message, /platformSpendCapCents=500/);
});

test("(j3) tenantCapRowInertFindings: keine Zeile >= platformCap -> leer", () => {
  const findings = bootGuardMod.tenantCapRowInertFindings({
    budgetRows: [{ tenantId: "x", hardCapCents: 300, budgetCents: 300 }],
    platformCapCents: 500,
  });
  assert.deepEqual(findings, []);
});

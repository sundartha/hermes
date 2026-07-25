// GAP-01 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-01").
// Abrechnungsperiode und Budget-Fenster sind dieselbe Achse - bei
// BUDGET_MONTH_ENABLED=false (render.yaml:310-311 UND test/helpers.js:277, der heute
// laufende Default) rechnet gateUsageCents() gegen den LEBENSZEIT-Verbrauch
// (bucket.costCents), den kein Codepfad zuruecksetzt - auch nicht ein Stripe-Webhook,
// der die Abrechnungsperiode verlaengert. Muster: test/plan-cap-derivation.test.js
// (pglite, dynamische Imports NACH process.env-Setup - Lehre test-base-env-drift).
process.env.MAX_BUDGET_EUR = "30";
process.env.VOICE_CAP_RATE_CENTS_PER_MIN = "6";

import test, { before } from "node:test";
import assert from "node:assert/strict";

let PGlite, makePgStore, config, subscribeMod, webhookMod, ops;

before(async () => {
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ config } = await import("../src/config.js"));
  subscribeMod = await import("../src/billing/subscribe.js");
  webhookMod = await import("../src/billing/webhook.js");
  ops = await import("../src/store/state-ops.js");
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
  return { store };
}

function fakeSubscribeBilling() {
  return {
    createSubscription: async () => ({
      subscriptionId: "sub_gap01",
      currentPeriodEnd: 1893456000,
      currentPeriodStart: 1890864000,
    }),
  };
}

test("GAP-01 SOLL: nach einem Stripe-Perioden-Wechsel ist die EUR-Gate-Achse zurueckgesetzt (BUDGET_MONTH_ENABLED=false)", async () => {
  assert.equal(config.billing.budgetMonthEnabled, false, "Vorbedingung: der heute laufende Default");

  const { store } = await makeTestStore();
  const tenantId = "t_gap01";
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Gap01" });
  store.setTenantStripe(tenantId, { customerId: "cus_gap01", paymentMethodId: "pm_gap01" });

  await subscribeMod.createTenantSubscription({
    store,
    billing: fakeSubscribeBilling(),
    config,
    tenant: tenantId,
    planSlug: "starter",
  });
  assert.equal(store.tenantBudgetSnapshot(tenantId, config.billing).capCents, 300, "Vorbedingung: Starter-Decke");

  // Verbrauch exakt auf die Decke buchen -> Gate erschoepft.
  store.addVoiceUsageCostCents(tenantId, 300);
  assert.equal(store.budgetExceeded(tenantId, config.billing), true, "Vorbedingung: Decke erreicht");

  // Stripe verlaengert die Abrechnungsperiode (KEIN plan_slug -> reine Perioden-Verlaengerung,
  // Muster test/plan-cap-derivation.test.js Test (g)).
  const event = {
    type: webhookMod.SUBSCRIPTION_EVENT.UPDATED,
    data: {
      object: {
        id: "sub_gap01",
        status: "active",
        current_period_end: 1896134400,
        current_period_start: 1893456000,
        metadata: { tenant_ref: tenantId },
      },
    },
  };
  await webhookMod.applyStripeWebhook(event, {
    store,
    accounts: { setStatus: async () => {} },
    sessions: { invalidateByTenant: async () => {} },
    audit: () => {},
    req: {},
    provision: async () => {},
    billing: undefined,
  });
  assert.equal(
    store.tenantSubscription(tenantId).currentPeriodEnd,
    1896134400,
    "Vorbedingung: der Perioden-Anker ist tatsaechlich weitergezogen",
  );

  assert.equal(
    store.budgetExceeded(tenantId, config.billing),
    false,
    "SOLL: eine neue Abrechnungsperiode setzt die EUR-Gate-Achse zurueck - heute bleibt " +
      "gateUsageCents() der LEBENSZEIT-Verbrauch (bucket.costCents), den kein Codepfad " +
      "zuruecksetzt (state-ops.js:1959-1961)",
  );
});

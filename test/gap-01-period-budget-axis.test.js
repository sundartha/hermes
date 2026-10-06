process.env.MAX_BUDGET_EUR = "30";
process.env.VOICE_TARIFF_DEFAULT_CENTS = "6";

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

async function makeExhaustedTenant(tenantId) {
  const { store } = await makeTestStore();
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

  store.addVoiceUsageCostCents(tenantId, 300);
  assert.equal(store.budgetExceeded(tenantId, config.billing), true, "Vorbedingung: Decke erreicht");
  return store;
}

function periodUpdateEvent(tenantId, { status = "active" } = {}) {
  return {
    type: webhookMod.SUBSCRIPTION_EVENT.UPDATED,
    data: {
      object: {
        id: "sub_gap01",
        status,
        current_period_end: 1896134400,
        current_period_start: 1893456000,
        metadata: { tenant_ref: tenantId },
      },
    },
  };
}

function applyEvent(store, event) {
  return webhookMod.applyStripeWebhook(event, {
    store,
    accounts: { setStatus: async () => {} },
    sessions: { invalidateByTenant: async () => {} },
    audit: () => {},
    req: {},
    provision: async () => {},
    billing: undefined,
  });
}

test("nach einem Stripe-Perioden-Wechsel ist die EUR-Gate-Achse zurueckgesetzt (BUDGET_MONTH_ENABLED=false)", async () => {
  assert.equal(config.billing.budgetMonthEnabled, false, "Vorbedingung: der heute laufende Default");

  const tenantId = "t_gap01";
  const store = await makeExhaustedTenant(tenantId);
  await applyEvent(store, periodUpdateEvent(tenantId));
  assert.equal(
    store.tenantSubscription(tenantId).currentPeriodEnd,
    1896134400,
    "Vorbedingung: der Perioden-Anker ist tatsaechlich weitergezogen",
  );

  assert.equal(
    store.budgetExceeded(tenantId, config.billing),
    false,
    "eine neue Abrechnungsperiode setzt die EUR-Gate-Achse zurueck",
  );
});

test("past_due setzt die Achse NICHT zurueck und zieht den Perioden-Anker nicht weiter", async () => {
  const tenantId = "t_gap01_pastdue";
  const store = await makeExhaustedTenant(tenantId);
  const before = store.tenantSubscription(tenantId).currentPeriodEnd;

  await applyEvent(store, periodUpdateEvent(tenantId, { status: "past_due" }));

  assert.equal(store.tenantSubscription(tenantId).currentPeriodEnd, before, "Anker unveraendert");
  assert.equal(store.budgetExceeded(tenantId, config.billing), true, "Achse bleibt gesperrt");
});

test("aktiver billingHold verhindert den Reset trotz status=active", async () => {
  const tenantId = "t_gap01_hold";
  const store = await makeExhaustedTenant(tenantId);
  store.setBillingHold(tenantId, { reason: "payment_failed" });
  assert.ok(store.billingHoldActive(tenantId), "Vorbedingung: Hold ist scharf");

  await applyEvent(store, periodUpdateEvent(tenantId));

  assert.equal(store.budgetExceeded(tenantId, config.billing), true, "kein Freikontingent bei offener Rechnung");
});

test("dasselbe Event zweimal oeffnet genau EIN Fenster (Baseline unveraendert)", async () => {
  const tenantId = "t_gap01_retry";
  const store = await makeExhaustedTenant(tenantId);

  await applyEvent(store, periodUpdateEvent(tenantId));
  const baselineAfterFirst = store.usageOf(tenantId).budgetPeriodBaselineCents;
  store.addVoiceUsageCostCents(tenantId, 290);

  await applyEvent(store, periodUpdateEvent(tenantId));

  assert.equal(
    store.usageOf(tenantId).budgetPeriodBaselineCents,
    baselineAfterFirst,
    "ein Retry darf die Baseline nicht nachziehen",
  );
  assert.equal(
    store.budgetExceeded(tenantId, config.billing),
    false,
    "290 von 300 verbraucht - das Fenster laeuft weiter, es beginnt kein zweites",
  );
});

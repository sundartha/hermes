// GAP-01 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-01"), umgesetzt
// in P6: Abrechnungsperiode und Budget-Fenster sind DIESELBE Achse. Bei
// BUDGET_MONTH_ENABLED=false (dem heute laufenden Default) misst gateUsageCents() den
// Verbrauch SEIT dem Beginn der laufenden Stripe-Abrechnungsperiode; der Stempel liegt auf
// derselben Kante wie die Reaktivierung (billing/activation.js activatePaidTenant).
// Muster: test/plan-cap-derivation.test.js (pglite, dynamische Imports NACH
// process.env-Setup - Lehre test-base-env-drift).
//
// A3: die Testnamen tragen KEINE Katalog-ID mehr - die Faelle sind seit P6 gruener
// Regressionsschutz und gehoeren damit in `npm test`, nicht in `test:gates`.
//
// KS-P5a: die Plan-Decke folgt seit E5a dem BUCHUNGSSATZ (voiceTariffDefaultCents). Der
// Fixtur-Wert 6 bleibt bewusst stehen - geprueft wird das Budget-FENSTER, nicht der Tarif.
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
  config.billing.stripeProPriceId = "price_pro_test";
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

// Baut einen zahlenden Tenant mit Starter-Abo und dem Verbrauch, der seine Decke exakt
// erschoepft (Build-Schritt aus P13 Build-Operate-Check, EIN Setup fuer alle Faelle).
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

// Stripe verlaengert die Abrechnungsperiode (KEIN plan_slug -> reine Perioden-Verlaengerung,
// Muster test/plan-cap-derivation.test.js Test (g)).
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

// W1 (O4): eine gescheiterte Zahlung darf kein Kontingent oeffnen. past_due wird von
// interpretStripeEvent als IGNORE verworfen (CONFIRMED_SUBSCRIPTION_STATUS) - die
// Reset-Bedingung ist damit STRUKTURELL an die Reaktivierung gekoppelt, nicht per Konvention.
test("past_due setzt die Achse NICHT zurueck und zieht den Perioden-Anker nicht weiter", async () => {
  const tenantId = "t_gap01_pastdue";
  const store = await makeExhaustedTenant(tenantId);
  const before = store.tenantSubscription(tenantId).currentPeriodEnd;

  await applyEvent(store, periodUpdateEvent(tenantId, { status: "past_due" }));

  assert.equal(store.tenantSubscription(tenantId).currentPeriodEnd, before, "Anker unveraendert");
  assert.equal(store.budgetExceeded(tenantId, config.billing), true, "Achse bleibt gesperrt");
});

// W2 (O4): wer eine ungeklaerte Rechnung hat, bekommt kein frisches Kontingent auf
// Plattformkosten - auch wenn Stripe das Abo formal als active meldet.
test("aktiver billingHold verhindert den Reset trotz status=active", async () => {
  const tenantId = "t_gap01_hold";
  const store = await makeExhaustedTenant(tenantId);
  store.setBillingHold(tenantId, { reason: "payment_failed" });
  assert.ok(store.billingHoldActive(tenantId), "Vorbedingung: Hold ist scharf");

  await applyEvent(store, periodUpdateEvent(tenantId));

  assert.equal(store.budgetExceeded(tenantId, config.billing), true, "kein Freikontingent bei offener Rechnung");
});

// W3: derselbe Webhook zweimal (Stripe-Retry) oeffnet GENAU EIN Fenster - der Monotonie-/
// Idempotenz-Riegel in stampBudgetPeriod verhindert ein zweites Freikontingent.
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

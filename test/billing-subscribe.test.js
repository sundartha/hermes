// W4 — createTenantSubscription/priceIdForPlan: reine Orchestrierung ueber Fake-Store +
// Fake-Billing (kein IO, kein Netz, F.I.R.S.T.). Deckt die fail-closed-Gates
// (unknown_plan/plan_unconfigured/already_subscribed/no_card) + den Happy-Pfad
// (persistiert die Abo-Felder, KEIN Status-Flip hier) ab.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTenantSubscription,
  priceIdForPlan,
  activateSubscriptionFromCheckoutSession,
  hasActiveSubscription,
  checkoutSessionIdempotencyKey,
} from "../src/billing/subscribe.js";

const TENANT = "t_x";
const CONFIG = { stripeStarterPriceId: "price_starter", stripeBusinessPriceId: "price_business" };

// Fake-Store: haelt EINEN Tenant-Bucket mit stripe-Karte + Abo-Referenzen, exakt die
// Felder, die subscribe.js liest/schreibt (Fassaden-Form).
function fakeStore({ card = true, sub = null, pm = "pm_x" } = {}) {
  const state = {
    stripe: card
      ? { customerId: "cus_x", paymentMethodId: pm }
      : { customerId: null, paymentMethodId: null },
    subscription: { subscriptionId: sub, planSlug: null, currentPeriodEnd: null },
    kycLevel: null,
  };
  return {
    state,
    tenantStripe: () => state.stripe,
    tenantSubscription: () => state.subscription,
    setTenantStripe: (_t, patch) => Object.assign(state.stripe, patch),
    setTenantSubscription: (_t, patch) => {
      Object.assign(state.subscription, patch);
      return state.subscription;
    },
    setKycLevel: (_t, level) => {
      state.kycLevel = level;
    },
    setProfile: () => ({ changed: ["maxNumbers"] }),
  };
}

function fakeBilling(spy = {}) {
  return {
    createSubscription: async (params) => {
      spy.params = params;
      return { subscriptionId: "sub_new", currentPeriodEnd: 1893456000, currentPeriodStart: 1890864000 };
    },
  };
}

test("priceIdForPlan: bekannte Slugs -> Price, unbekannt/unkonfiguriert -> null", () => {
  assert.equal(priceIdForPlan("starter", CONFIG), "price_starter");
  assert.equal(priceIdForPlan("business", CONFIG), "price_business");
  assert.equal(priceIdForPlan("enterprise", CONFIG), null, "unbekannter Slug -> null");
  assert.equal(priceIdForPlan("starter", {}), null, "fehlende Price-Id -> null");
});

test("createTenantSubscription: unbekannter Plan -> unknown_plan, kein Stripe-Call", async () => {
  const spy = {};
  const r = await createTenantSubscription({
    store: fakeStore(), billing: fakeBilling(spy), config: CONFIG, tenant: TENANT, planSlug: "gold",
  });
  assert.deepEqual(r, { ok: false, reason: "unknown_plan" });
  assert.equal(spy.params, undefined, "kein createSubscription bei unbekanntem Plan");
});

test("createTenantSubscription: konfigurierter Tier ohne Price -> plan_unconfigured", async () => {
  const r = await createTenantSubscription({
    store: fakeStore(), billing: fakeBilling(), config: {}, tenant: TENANT, planSlug: "starter",
  });
  assert.deepEqual(r, { ok: false, reason: "plan_unconfigured" });
});

test("createTenantSubscription: ohne Karte -> no_card, kein Stripe-Call", async () => {
  const spy = {};
  const r = await createTenantSubscription({
    store: fakeStore({ card: false }), billing: fakeBilling(spy), config: CONFIG, tenant: TENANT, planSlug: "starter",
  });
  assert.deepEqual(r, { ok: false, reason: "no_card" });
  assert.equal(spy.params, undefined, "kein createSubscription ohne Karte");
});

test("createTenantSubscription: bereits abonniert -> already_subscribed (Doppelabbuchungs-Schutz)", async () => {
  const spy = {};
  const r = await createTenantSubscription({
    store: fakeStore({ sub: "sub_old" }), billing: fakeBilling(spy), config: CONFIG, tenant: TENANT, planSlug: "starter",
  });
  assert.deepEqual(r, { ok: false, reason: "already_subscribed" });
  assert.equal(spy.params, undefined, "kein zweites Abo");
});

test("createTenantSubscription: Happy-Pfad persistiert Abo-Felder + reicht Idempotency-Key durch", async () => {
  const spy = {};
  const store = fakeStore();
  const r = await createTenantSubscription({
    store, billing: fakeBilling(spy), config: CONFIG, tenant: TENANT, planSlug: "business",
  });
  assert.equal(r.ok, true);
  assert.equal(r.planSlug, "business");
  assert.equal(r.subscriptionId, "sub_new");
  assert.equal(r.currentPeriodEnd, 1893456000);
  // Stripe-Call mit dem richtigen Price + Idempotency-Key (tenant+plan+Karten-Suffix).
  assert.equal(spy.params.priceId, "price_business");
  assert.equal(spy.params.customerId, "cus_x");
  // Die on-file-Karte wird als default_payment_method durchgereicht (sonst Stripe-400).
  assert.equal(spy.params.paymentMethodId, "pm_x");
  assert.equal(spy.params.idempotencyKey, "sub_t_x_business_pm_x");
  // persistiert am Tenant (KEIN Status-Flip - der liegt im Route-Layer).
  assert.equal(store.state.subscription.subscriptionId, "sub_new");
  assert.equal(store.state.subscription.planSlug, "business");
  assert.equal(store.state.subscription.currentPeriodEnd, 1893456000);
  // B1a: der Periodenanker (currentPeriodStart) wird mit in den Store gefaedelt.
  assert.equal(store.state.subscription.currentPeriodStart, 1890864000);
});

test("createTenantSubscription: andere Karte -> anderer Idempotenz-Key (kein Param-Konflikt nach Karten-Neuwahl), gleiche Karte dedupt", async () => {
  const a = {}, b = {}, again = {};
  const runWith = (pm, spy) =>
    createTenantSubscription({
      store: fakeStore({ pm }), billing: fakeBilling(spy), config: CONFIG, tenant: TENANT, planSlug: "starter",
    });
  await runWith("pm_first", a);
  await runWith("pm_second", b);
  await runWith("pm_first", again);
  assert.notEqual(a.params.idempotencyKey, b.params.idempotencyKey, "neue Karte -> neuer Key");
  assert.equal(a.params.idempotencyKey, again.params.idempotencyKey, "gleiche Karte -> selber Key (Doppelklick dedupt)");
  assert.ok(a.params.idempotencyKey.startsWith("sub_t_x_starter_"), "Tenant+Plan bleiben stabil im Key");
  assert.ok(a.params.idempotencyKey.endsWith("pm_first"), "nur das PM-Suffix, nie ein anderer Wert");
});

// ---- Review-Blocker Runde 1: checkoutSessionIdempotencyKey + hasActiveSubscription --

test("checkoutSessionIdempotencyKey: deterministisch aus Tenant+Plan+Price (kein Zufall), unterscheidet Plaene/Prices/Tenants, KEIN PM-Suffix", () => {
  assert.equal(
    checkoutSessionIdempotencyKey("t_x", "starter", "price_a"),
    checkoutSessionIdempotencyKey("t_x", "starter", "price_a"),
    "gleicher Tenant+Plan+Price -> gleicher Key (Doppelklick/zwei Tabs bekommen dieselbe Session)",
  );
  assert.notEqual(
    checkoutSessionIdempotencyKey("t_x", "starter", "price_a"),
    checkoutSessionIdempotencyKey("t_x", "starter", "price_b"),
    "anderer Price (Preis-Update) -> anderer Key (kein idempotency_error/24h-Lockout)",
  );
  assert.notEqual(
    checkoutSessionIdempotencyKey("t_x", "starter", "price_a"),
    checkoutSessionIdempotencyKey("t_x", "business", "price_a"),
    "anderer Plan -> anderer Key",
  );
  assert.notEqual(
    checkoutSessionIdempotencyKey("t_x", "starter", "price_a"),
    checkoutSessionIdempotencyKey("t_y", "starter", "price_a"),
    "anderer Tenant -> anderer Key",
  );
});

test("hasActiveSubscription: gemeinsames Praedikat spiegelt store.tenantSubscription(tenant).subscriptionId", () => {
  assert.equal(hasActiveSubscription(fakeStore(), TENANT), false, "kein Abo -> false");
  assert.equal(hasActiveSubscription(fakeStore({ sub: "sub_old" }), TENANT), true, "Abo vorhanden -> true");
});

// ---- BK-Discount: activateSubscriptionFromCheckoutSession (Sicherheits-Gates) -------

const CHECKOUT_OUTCOME = Object.freeze({
  customerId: "cus_x",
  paymentMethodId: "pm_checkout",
  subscriptionId: "sub_checkout",
  currentPeriodStart: 1890864000,
  currentPeriodEnd: 1893456000,
  planSlug: "starter",
});

function fakeCheckoutBilling(outcomeOverrides = {}) {
  return {
    getSubscriptionCheckoutResult: async () => ({ ...CHECKOUT_OUTCOME, ...outcomeOverrides }),
  };
}

// accounts/provision-Fakes: zeichnen nur auf, WAS activatePaidTenant aufruft (setStatus +
// provision), kein echtes IO (F.I.R.S.T.).
function activationSpies() {
  const calls = { status: [], provisioned: [] };
  return {
    calls,
    accounts: { setStatus: async (tenant, status) => calls.status.push({ tenant, status }) },
    provision: async (tenant) => calls.provisioned.push(tenant),
  };
}

function runActivate({ store, billing, expectedPlanSlug = "starter" }) {
  const { accounts, provision, calls } = activationSpies();
  return activateSubscriptionFromCheckoutSession({
    store,
    billing,
    accounts,
    provision,
    tenant: TENANT,
    sessionId: "cs_sub_1",
    expectedPlanSlug,
  }).then((result) => ({ result, calls, store }));
}

test("activateSubscriptionFromCheckoutSession: fremder Customer -> customer_mismatch, nichts persistiert", async () => {
  const store = fakeStore({ card: true });
  store.state.stripe.customerId = "cus_owner"; // gespeichert != Session-Customer
  const { result, calls } = await runActivate({
    store,
    billing: fakeCheckoutBilling({ customerId: "cus_fremd" }),
  });
  assert.deepEqual(result, { ok: false, reason: "customer_mismatch" });
  assert.equal(store.state.subscription.subscriptionId, null, "kein Abo persistiert");
  assert.equal(calls.status.length, 0, "keine Aktivierung");
  assert.equal(calls.provisioned.length, 0, "kein Provisioning");
});

test("activateSubscriptionFromCheckoutSession: kein gespeicherter Customer -> customer_mismatch (T5-Grenzfall)", async () => {
  const store = fakeStore({ card: false });
  const { result } = await runActivate({ store, billing: fakeCheckoutBilling() });
  assert.deepEqual(result, { ok: false, reason: "customer_mismatch" });
  assert.equal(store.state.subscription.subscriptionId, null);
});

test("activateSubscriptionFromCheckoutSession: Customer-Match-Reihenfolge vor already_subscribed (fremde Session bricht sofort ab)", async () => {
  const store = fakeStore({ card: true, sub: "sub_old" });
  store.state.stripe.customerId = "cus_owner";
  const { result } = await runActivate({
    store,
    billing: fakeCheckoutBilling({ customerId: "cus_fremd" }),
  });
  assert.deepEqual(result, { ok: false, reason: "customer_mismatch" }, "Customer-Gate schlaegt zuerst zu");
  assert.equal(store.state.subscription.subscriptionId, "sub_old", "bestehendes Abo unveraendert");
});

test("activateSubscriptionFromCheckoutSession: Plan-Mismatch (Query-Tamper) -> plan_mismatch, nichts persistiert", async () => {
  const store = fakeStore({ card: true });
  const { result, calls } = await runActivate({
    store,
    billing: fakeCheckoutBilling({ planSlug: "business" }),
    expectedPlanSlug: "starter",
  });
  assert.deepEqual(result, { ok: false, reason: "plan_mismatch" });
  assert.equal(store.state.subscription.subscriptionId, null);
  assert.equal(calls.status.length, 0);
});

test("activateSubscriptionFromCheckoutSession: fehlender plan_slug -> plan_mismatch, nie raten", async () => {
  const store = fakeStore({ card: true });
  const { result } = await runActivate({
    store,
    billing: fakeCheckoutBilling({ planSlug: null }),
  });
  assert.deepEqual(result, { ok: false, reason: "plan_mismatch" });
});

test("activateSubscriptionFromCheckoutSession: bereits abonniert, IDENTISCHE subscriptionId (Doppel-Redirect derselben Session) -> already_subscribed, nichts ueberschrieben", async () => {
  const store = fakeStore({ card: true, sub: "sub_checkout" }); // == CHECKOUT_OUTCOME.subscriptionId
  store.state.subscription.planSlug = "starter";
  store.state.subscription.currentPeriodEnd = 1700000000;
  const { result } = await runActivate({ store, billing: fakeCheckoutBilling() });
  assert.deepEqual(result, { ok: false, reason: "already_subscribed" });
  assert.equal(store.state.subscription.subscriptionId, "sub_checkout", "altes Abo bleibt unveraendert");
  assert.equal(store.state.subscription.currentPeriodEnd, 1700000000);
});

// Review-Blocker Runde 2 (P16/G3, Cross-Plan-Race): zwei nahezu gleichzeitige
// setup-checkout-Aufrufe fuer VERSCHIEDENE Plaene erzeugen zwei ECHTE, real
// abgerechnete Stripe-Subscriptions (verschiedene Idempotency-Keys). Die zweite
// Rueckkehr traegt eine ANDERE outcome.subscriptionId als die bereits gespeicherte -
// das ist KEIN harmloser Doppel-Redirect, sondern eine verwaiste Zweit-Subscription.
// Muss NIE als already_subscribed/Erfolg gewertet werden.
test("activateSubscriptionFromCheckoutSession: bereits abonniert, ABWEICHENDE subscriptionId (Cross-Plan-Race) -> subscription_conflict, nichts ueberschrieben", async () => {
  const store = fakeStore({ card: true, sub: "sub_old" }); // != CHECKOUT_OUTCOME.subscriptionId ("sub_checkout")
  store.state.subscription.planSlug = "starter";
  store.state.subscription.currentPeriodEnd = 1700000000;
  const { result, calls } = await runActivate({ store, billing: fakeCheckoutBilling() });
  assert.deepEqual(result, {
    ok: false,
    reason: "subscription_conflict",
    subscriptionId: "sub_checkout",
  });
  assert.equal(store.state.subscription.subscriptionId, "sub_old", "das bestehende Abo bleibt unveraendert");
  assert.equal(store.state.subscription.currentPeriodEnd, 1700000000);
  assert.equal(calls.status.length, 0, "keine Aktivierung der verwaisten Subscription");
  assert.equal(calls.provisioned.length, 0, "kein Provisioning der verwaisten Subscription");
});

test("activateSubscriptionFromCheckoutSession: Happy-Pfad persistiert Karte+Abo und aktiviert vollstaendig", async () => {
  const store = fakeStore({ card: true });
  const { result, calls } = await runActivate({ store, billing: fakeCheckoutBilling() });
  assert.equal(result.ok, true);
  assert.equal(result.subscriptionId, "sub_checkout");
  assert.equal(result.planSlug, "starter");
  assert.equal(result.currentPeriodEnd, 1893456000);
  // Karte + Abo aus der Session persistiert (kein zweiter Geld-Call).
  assert.equal(store.state.stripe.paymentMethodId, "pm_checkout");
  assert.equal(store.state.subscription.subscriptionId, "sub_checkout");
  assert.equal(store.state.subscription.currentPeriodStart, 1890864000);
  // activatePaidTenant-Kette lief vollstaendig: KYC->Status->Provisioning->Profil.
  assert.equal(store.state.kycLevel, "card");
  assert.deepEqual(calls.status, [{ tenant: TENANT, status: "active" }]);
  assert.deepEqual(calls.provisioned, [TENANT]);
  assert.equal(result.profile.provisioned, true);
});

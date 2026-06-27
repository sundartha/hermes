// W4 — createTenantSubscription/priceIdForPlan: reine Orchestrierung ueber Fake-Store +
// Fake-Billing (kein IO, kein Netz, F.I.R.S.T.). Deckt die fail-closed-Gates
// (unknown_plan/plan_unconfigured/already_subscribed/no_card) + den Happy-Pfad
// (persistiert die Abo-Felder, KEIN Status-Flip hier) ab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTenantSubscription, priceIdForPlan } from "../src/billing/subscribe.js";

const TENANT = "t_x";
const CONFIG = { stripeStarterPriceId: "price_starter", stripeBusinessPriceId: "price_business" };

// Fake-Store: haelt EINEN Tenant-Bucket mit stripe-Karte + Abo-Referenzen, exakt die
// Felder, die subscribe.js liest/schreibt (Fassaden-Form).
function fakeStore({ card = true, sub = null } = {}) {
  const state = {
    stripe: card ? { customerId: "cus_x", paymentMethodId: "pm_x" } : { customerId: null, paymentMethodId: null },
    subscription: { subscriptionId: sub, planSlug: null, currentPeriodEnd: null },
  };
  return {
    state,
    tenantStripe: () => state.stripe,
    tenantSubscription: () => state.subscription,
    setTenantSubscription: (_t, patch) => {
      Object.assign(state.subscription, patch);
      return state.subscription;
    },
  };
}

function fakeBilling(spy = {}) {
  return {
    createSubscription: async (params) => {
      spy.params = params;
      return { subscriptionId: "sub_new", currentPeriodEnd: 1893456000 };
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
  // Stripe-Call mit dem richtigen Price + stabilem Idempotency-Key (tenant+plan).
  assert.equal(spy.params.priceId, "price_business");
  assert.equal(spy.params.customerId, "cus_x");
  // Die on-file-Karte wird als default_payment_method durchgereicht (sonst Stripe-400).
  assert.equal(spy.params.paymentMethodId, "pm_x");
  assert.equal(spy.params.idempotencyKey, "sub_t_x_business");
  // persistiert am Tenant (KEIN Status-Flip - der liegt im Route-Layer).
  assert.equal(store.state.subscription.subscriptionId, "sub_new");
  assert.equal(store.state.subscription.planSlug, "business");
  assert.equal(store.state.subscription.currentPeriodEnd, 1893456000);
});

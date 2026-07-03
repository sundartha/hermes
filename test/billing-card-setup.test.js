// Review-Blocker Runde 3 (G5/S2): customerMatches war wortgleich in card-setup.js UND
// subscribe.js dupliziert - dieser Test deckt die EXTRAHIERTE Sicherheitsinvariante (R4)
// direkt ab, plus bindCardFromSession als ihren ersten Aufrufer (bisher nur indirekt ueber
// Routen-Tests gedeckt). Reine Orchestrierung ueber Fake-Store + Fake-Billing, kein IO.
import { test } from "node:test";
import assert from "node:assert/strict";
import { customerMatches, bindCardFromSession, ensureCustomer } from "../src/billing/card-setup.js";

const TENANT = "t_x";

function fakeStore({ customerId = null, paymentMethodId = null } = {}) {
  const state = { stripe: { customerId, paymentMethodId } };
  return {
    state,
    tenantStripe: () => state.stripe,
    setTenantStripe: (_t, patch) => Object.assign(state.stripe, patch),
  };
}

// ---- customerMatches (R4-Invariante, EINE Stelle statt Kopie in subscribe.js) --------

test("customerMatches: kein gespeicherter Customer -> false (T5-Grenzfall, nie raten)", () => {
  assert.equal(customerMatches(fakeStore(), TENANT, "cus_x"), false);
});

test("customerMatches: gespeicherter Customer weicht ab -> false (fremde session_id)", () => {
  const store = fakeStore({ customerId: "cus_owner" });
  assert.equal(customerMatches(store, TENANT, "cus_fremd"), false);
});

test("customerMatches: gespeicherter Customer == Session-Customer -> true", () => {
  const store = fakeStore({ customerId: "cus_x" });
  assert.equal(customerMatches(store, TENANT, "cus_x"), true);
});

// ---- bindCardFromSession: erster Aufrufer, ueber customerMatches fail-closed ----------

test("bindCardFromSession: fremder Customer -> ok:false, nichts persistiert", async () => {
  const store = fakeStore({ customerId: "cus_owner" });
  const billing = {
    getCheckoutSessionResult: async () => ({ customerId: "cus_fremd", paymentMethodId: "pm_new" }),
  };
  const result = await bindCardFromSession({ store, billing, tenant: TENANT, sessionId: "cs_1" });
  assert.deepEqual(result, { ok: false });
  assert.equal(store.state.stripe.paymentMethodId, null, "keine fremde Karte gebunden");
});

test("bindCardFromSession: passender Customer -> ok:true, Karte persistiert", async () => {
  const store = fakeStore({ customerId: "cus_x" });
  const billing = {
    getCheckoutSessionResult: async () => ({ customerId: "cus_x", paymentMethodId: "pm_new" }),
  };
  const result = await bindCardFromSession({ store, billing, tenant: TENANT, sessionId: "cs_1" });
  assert.deepEqual(result, { ok: true });
  assert.equal(store.state.stripe.paymentMethodId, "pm_new");
});

// ---- ensureCustomer: bestehende Idempotenz unveraendert (Regressions-Schutz) ---------

test("ensureCustomer: existierender Customer wird wiederverwendet, kein zweiter Stripe-Call", async () => {
  const store = fakeStore({ customerId: "cus_x" });
  const billing = { createCustomer: async () => assert.fail("kein zweiter createCustomer-Call erwartet") };
  const customerId = await ensureCustomer({ store, billing, tenant: TENANT });
  assert.equal(customerId, "cus_x");
});

test("ensureCustomer: kein Customer -> legt ihn an und persistiert", async () => {
  const store = fakeStore();
  const billing = { createCustomer: async () => ({ customerId: "cus_new" }) };
  const customerId = await ensureCustomer({ store, billing, tenant: TENANT });
  assert.equal(customerId, "cus_new");
  assert.equal(store.state.stripe.customerId, "cus_new");
});

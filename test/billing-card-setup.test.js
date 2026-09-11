// Review-Blocker Runde 3 (G5/S2): customerMatches war wortgleich in card-setup.js UND
// subscribe.js dupliziert - dieser Test deckt die EXTRAHIERTE Sicherheitsinvariante (R4)
// direkt ab, plus bindCardFromSession als ihren ersten Aufrufer (bisher nur indirekt ueber
// Routen-Tests gedeckt). Reine Orchestrierung ueber Fake-Store + Fake-Billing, kein IO.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  customerMatches,
  bindCardFromSession,
  ensureCustomer,
  startCheckoutWithStaleCustomerHeal,
} from "../src/billing/card-setup.js";
import { CustomerMissingError } from "../src/billing/errors.js";

const TENANT = "t_x";

function fakeStore({ customerId = null, paymentMethodId = null, paymentMethodType = null } = {}) {
  const state = { stripe: { customerId, paymentMethodId, paymentMethodType } };
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

test("bindCardFromSession: passender Customer -> ok:true, Karte UND Typ persistiert", async () => {
  const store = fakeStore({ customerId: "cus_x" });
  const billing = {
    getCheckoutSessionResult: async () => ({
      customerId: "cus_x",
      paymentMethodId: "pm_new",
      paymentMethodType: "card",
    }),
  };
  const result = await bindCardFromSession({ store, billing, tenant: TENANT, sessionId: "cs_1" });
  assert.deepEqual(result, { ok: true });
  assert.equal(store.state.stripe.paymentMethodId, "pm_new");
  assert.equal(store.state.stripe.paymentMethodType, "card", "GP-P2: der Typ wandert mit");
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

// ---- startCheckoutWithStaleCustomerHeal (Self-Heal, Fix B, PLAN-CHECKOUT-STALE-STRIPE-CUSTOMER.md) ----

test("startCheckoutWithStaleCustomerHeal: Happy-Path - Checkout gelingt sofort -> healed:false, kein createCustomer-Zusatzaufruf, kein sleep", async () => {
  const store = fakeStore({ customerId: "cus_x" });
  const sleeps = [];
  const billing = { createCustomer: async () => assert.fail("kein createCustomer erwartet") };
  const startCheckout = async (customerId) => ({ url: `https://stripe.test/${customerId}` });
  const result = await startCheckoutWithStaleCustomerHeal(
    { store, billing, tenant: TENANT, retryDelayMs: 1500, sleep: async (ms) => sleeps.push(ms) },
    startCheckout,
  );
  assert.deepEqual(result, { session: { url: "https://stripe.test/cus_x" }, healed: false });
  assert.deepEqual(sleeps, [], "kein Retry -> kein Warten");
  assert.equal(store.state.stripe.customerId, "cus_x", "Store unveraendert");
});

test("startCheckoutWithStaleCustomerHeal: gespeicherter Customer stale (CustomerMissingError) -> heilt, EIN Retry mit frischem Customer, PM mit geloescht, sleep mit retryDelayMs", async () => {
  const store = fakeStore({
    customerId: "cus_stale",
    paymentMethodId: "pm_stale",
    paymentMethodType: "card",
  });
  const billing = { createCustomer: async () => ({ customerId: "cus_fresh" }) };
  const calls = [];
  const sleeps = [];
  const startCheckout = async (customerId) => {
    calls.push(customerId);
    if (customerId === "cus_stale")
      throw new CustomerMissingError("Stripe createSetupCheckoutSession fehlgeschlagen: HTTP 400 resource_missing");
    return { url: "https://stripe.test/ok" };
  };
  const result = await startCheckoutWithStaleCustomerHeal(
    { store, billing, tenant: TENANT, retryDelayMs: 1500, sleep: async (ms) => sleeps.push(ms) },
    startCheckout,
  );
  assert.deepEqual(result, { session: { url: "https://stripe.test/ok" }, healed: true });
  assert.deepEqual(calls, ["cus_stale", "cus_fresh"], "Retry mit dem frisch angelegten Customer");
  assert.equal(store.state.stripe.customerId, "cus_fresh");
  assert.equal(store.state.stripe.paymentMethodId, null, "tote paymentMethodId wird mitgeloescht (haengt am toten Customer)");
  assert.equal(
    store.state.stripe.paymentMethodType,
    null,
    "GP-P2: der Typ verschwindet mit - sonst bescheinigte er der naechsten Methode Eignung",
  );
  assert.deepEqual(sleeps, [1500], "Wartezeit vor dem Retry");
});

test("startCheckoutWithStaleCustomerHeal: auch ein FRISCH angelegter Customer kann CustomerMissing treffen (Nachtrag 3, Sichtbarkeits-Verzoegerung) -> heilt trotzdem, 2 createCustomer-Calls", async () => {
  const store = fakeStore(); // kein Customer gespeichert
  let customerCallCount = 0;
  const billing = {
    createCustomer: async () => {
      customerCallCount += 1;
      return { customerId: customerCallCount === 1 ? "cus_1" : "cus_2" };
    },
  };
  const calls = [];
  const startCheckout = async (customerId) => {
    calls.push(customerId);
    if (customerId === "cus_1")
      throw new CustomerMissingError("Stripe createSetupCheckoutSession fehlgeschlagen: HTTP 400 resource_missing");
    return { url: "https://stripe.test/ok" };
  };
  const result = await startCheckoutWithStaleCustomerHeal(
    { store, billing, tenant: TENANT, retryDelayMs: 0 },
    startCheckout,
  );
  assert.equal(result.healed, true);
  assert.equal(customerCallCount, 2, "ensureCustomer legt zweimal an (initial + Heal)");
  assert.deepEqual(calls, ["cus_1", "cus_2"]);
});

test("startCheckoutWithStaleCustomerHeal: zweiter Fehlschlag propagiert unveraendert (kein Loop)", async () => {
  const store = fakeStore({ customerId: "cus_stale" });
  const billing = { createCustomer: async () => ({ customerId: "cus_fresh" }) };
  let checkoutCallCount = 0;
  const startCheckout = async (customerId) => {
    checkoutCallCount += 1;
    throw new CustomerMissingError(`Stripe x fehlgeschlagen: HTTP 400 resource_missing (${customerId})`);
  };
  await assert.rejects(
    () =>
      startCheckoutWithStaleCustomerHeal({ store, billing, tenant: TENANT, retryDelayMs: 0 }, startCheckout),
    CustomerMissingError,
  );
  assert.equal(checkoutCallCount, 2, "genau EIN Retry (kein Loop, kein dritter Versuch)");
});

test("startCheckoutWithStaleCustomerHeal: fremder Fehler propagiert sofort, kein Heal-Versuch, Store unveraendert", async () => {
  const store = fakeStore({ customerId: "cus_x", paymentMethodId: "pm_x" });
  const billing = { createCustomer: async () => assert.fail("kein Heal bei fremdem Fehler erwartet") };
  const sleeps = [];
  const startCheckout = async () => {
    throw new Error("irgendein anderer Stripe-Fehler");
  };
  await assert.rejects(
    () =>
      startCheckoutWithStaleCustomerHeal(
        { store, billing, tenant: TENANT, retryDelayMs: 1500, sleep: async (ms) => sleeps.push(ms) },
        startCheckout,
      ),
    /irgendein anderer Stripe-Fehler/,
  );
  assert.equal(store.state.stripe.customerId, "cus_x", "Store unveraendert");
  assert.equal(store.state.stripe.paymentMethodId, "pm_x");
  assert.deepEqual(sleeps, [], "kein Heal -> kein Warten");
});

test("startCheckoutWithStaleCustomerHeal: retryDelayMs 0 -> Heal laeuft, sleep wird NICHT gerufen (T5-Grenzfall)", async () => {
  const store = fakeStore({ customerId: "cus_stale" });
  const billing = { createCustomer: async () => ({ customerId: "cus_fresh" }) };
  const sleeps = [];
  const startCheckout = async (customerId) => {
    if (customerId === "cus_stale")
      throw new CustomerMissingError("Stripe createSetupCheckoutSession fehlgeschlagen: HTTP 400 resource_missing");
    return { url: "ok" };
  };
  const result = await startCheckoutWithStaleCustomerHeal(
    { store, billing, tenant: TENANT, retryDelayMs: 0, sleep: async (ms) => sleeps.push(ms) },
    startCheckout,
  );
  assert.equal(result.healed, true);
  assert.deepEqual(sleeps, [], "0 = sofortiger Retry, kein sleep-Aufruf");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";
import { applyStripeWebhook, SUBSCRIPTION_EVENT } from "../src/billing/webhook.js";
import {
  bindCardFromSession,
  startCheckoutWithStaleCustomerHeal,
} from "../src/billing/card-setup.js";
import { activateSubscriptionFromCheckoutSession } from "../src/billing/subscribe.js";
import { CustomerMissingError } from "../src/billing/errors.js";
import { isHoldCapablePaymentMethodType } from "../src/billing/payment-method-eligibility.js";
import { provisionNumber } from "../src/onboarding.js";
import { fakeBilling, fakeProvisioner, makeStripeStub } from "./helpers.js";
import { makePgTestStore } from "./pg-helpers.js";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  setTenantStripe,
  setTenantSubscription,
  tenantStripe,
  findNumber,
} from "../src/store/state-ops.js";
import { makePgStore } from "../src/store/pg.js";
import { NUMBER_STATUS } from "../src/store/defaults.js";

const SECRET = "sk_test_gpp2";
const withStripeStub = makeStripeStub(config, SECRET);
const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

test("GP-P2: getCheckoutSessionResult, unexpandierte Bestandsform -> Id bleibt, Typ null, KEIN Wurf", async () => {
  const result = await withStripeStub(
    async () => okJson({ customer: "cus_1", setup_intent: { payment_method: "pm_1" } }),
    () => stripeBilling.getCheckoutSessionResult("cs_1"),
  );
  assert.deepEqual(result, {
    customerId: "cus_1",
    paymentMethodId: "pm_1",
    paymentMethodType: null,
  });
});

test("GP-P2: getCheckoutSessionResult, expandiertes payment_method -> Id aus dem Objekt, Typ mitgeliefert", async () => {
  const result = await withStripeStub(
    async () =>
      okJson({ customer: "cus_1", setup_intent: { payment_method: { id: "pm_x", type: "card" } } }),
    () => stripeBilling.getCheckoutSessionResult("cs_1"),
  );
  assert.equal(result.paymentMethodId, "pm_x");
  assert.equal(result.paymentMethodType, "card");
});

test("GP-P2: getCheckoutSessionResult expandiert setup_intent UND dessen payment_method", async () => {
  let captured;
  await withStripeStub(
    async (url) => {
      captured = url;
      return okJson({
        customer: "cus_1",
        setup_intent: { payment_method: { id: "pm_x", type: "card" } },
      });
    },
    () => stripeBilling.getCheckoutSessionResult("cs_1"),
  );
  assert.ok(captured.includes("expand[]=setup_intent"), "Bestands-Expand bleibt");
  assert.ok(
    captured.includes("expand[]=setup_intent.payment_method"),
    "ohne die zweite Ebene traegt die Antwort den Typ gar nicht",
  );
});

test("GP-P2: getSubscriptionCheckoutResult liefert den Typ nur aus der expandierten Objektform", async () => {
  const subMit = {
    id: "sub_1",
    default_payment_method: { id: "pm_b", type: "link" },
    items: { data: [{ current_period_start: 1, current_period_end: 2 }] },
    metadata: { plan_slug: "starter" },
  };
  const mit = await withStripeStub(
    async () => okJson({ customer: "cus_1", subscription: subMit }),
    () => stripeBilling.getSubscriptionCheckoutResult("cs_sub_1"),
  );
  assert.equal(mit.paymentMethodType, "link", "der Typ des Vorfalls wird sichtbar gemacht");

  const ohne = await withStripeStub(
    async () =>
      okJson({
        customer: "cus_1",
        subscription: { ...subMit, default_payment_method: "pm_string" },
      }),
    () => stripeBilling.getSubscriptionCheckoutResult("cs_sub_1"),
  );
  assert.equal(ohne.paymentMethodType, null, "unexpandierter String traegt keinen Typ");
});

test("GP-P2: retrievePaymentMethodType liest GET /v1/payment_methods/<id> und gibt NUR den Enum heraus", async () => {
  let captured;
  const typ = await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return okJson({
        id: "pm_x",
        type: "card",
        billing_details: { email: "kunde@example.invalid", name: "Erika Mustermann" },
      });
    },
    () => stripeBilling.retrievePaymentMethodType("pm_x"),
  );
  assert.ok(captured.url.endsWith("/v1/payment_methods/pm_x"), "rein lesender Pfad");
  assert.equal(captured.opts.method, "GET");
  assert.equal(captured.opts.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(typ, "card", "es kommt der Enum heraus - und nur er");
  assert.doesNotMatch(String(typ), /example\.invalid|Mustermann/);
});

test("GP-P2: retrievePaymentMethodType, Antwort ohne type -> null (fail-closed, nie raten)", async () => {
  const typ = await withStripeStub(
    async () => okJson({ id: "pm_x" }),
    () => stripeBilling.retrievePaymentMethodType("pm_x"),
  );
  assert.equal(typ, null);
});

test("GP-P2: retrievePaymentMethodType, Nicht-2xx -> wirft mit Status, OHNE Schluessel in der Meldung", async () => {
  await withStripeStub(
    async () => ({ ok: false, status: 402, json: async () => ({}) }),
    async () => {
      await assert.rejects(
        () => stripeBilling.retrievePaymentMethodType("pm_x"),
        (err) => {
          assert.match(err.message, /HTTP 402/);
          assert.doesNotMatch(err.message, /sk_test|Bearer/);
          return true;
        },
      );
    },
  );
});

const TENANT = "t_gpp2";

function fakeStore({
  customerId = "cus_gpp2",
  paymentMethodId = null,
  paymentMethodType = null,
} = {}) {
  const state = {
    stripe: { customerId, paymentMethodId, paymentMethodType },
    subscription: { subscriptionId: null, planSlug: null, currentPeriodEnd: null },
  };
  return {
    state,
    tenantStripe: () => state.stripe,
    tenantSubscription: () => state.subscription,
    setTenantStripe: (_t, patch) => Object.assign(state.stripe, patch),
    setTenantSubscription: (_t, patch) => Object.assign(state.subscription, patch),
    setKycLevel: () => {},
    setProfile: () => ({ profile: {}, changed: [] }),
    clearSuspendedAt: () => {},
    clearBillingHold: () => {},
    billingHoldActive: () => null,
    stampBudgetPeriod: () => false,
    ensureTenant: async () => {},
  };
}

test("GP-P2: bindCardFromSession schreibt den Typ - und ueberschreibt einen alten Typ mit null statt ihn stehen zu lassen", async () => {
  const store = fakeStore({ paymentMethodId: "pm_alt", paymentMethodType: "card" });
  const billing = {
    getCheckoutSessionResult: async () => ({
      customerId: "cus_gpp2",
      paymentMethodId: "pm_neu",
      paymentMethodType: null,
    }),
  };
  await bindCardFromSession({ store, billing, tenant: TENANT, sessionId: "cs_1" });
  assert.equal(store.state.stripe.paymentMethodId, "pm_neu");
  assert.equal(store.state.stripe.paymentMethodType, null, "kein staler Typ ueberlebt");

  const store2 = fakeStore();
  await bindCardFromSession({
    store: store2,
    billing: {
      getCheckoutSessionResult: async () => ({
        customerId: "cus_gpp2",
        paymentMethodId: "pm_neu",
        paymentMethodType: "card",
      }),
    },
    tenant: TENANT,
    sessionId: "cs_1",
  });
  assert.equal(store2.state.stripe.paymentMethodType, "card");
});

const CHECKOUT_OUTCOME = Object.freeze({
  customerId: "cus_gpp2",
  paymentMethodId: "pm_checkout",
  paymentMethodType: "card",
  subscriptionId: "sub_checkout",
  currentPeriodStart: 1890864000,
  currentPeriodEnd: 1893456000,
  planSlug: "starter",
});

function runActivateFromCheckout(store) {
  return activateSubscriptionFromCheckoutSession({
    store,
    billing: { getSubscriptionCheckoutResult: async () => ({ ...CHECKOUT_OUTCOME }) },
    accounts: { setStatus: async () => {} },
    provision: async () => ({ ok: true, reason: "queued" }),
    tenant: TENANT,
    sessionId: "cs_sub_1",
    expectedPlanSlug: "starter",
  });
}

test("GP-P2: activateSubscriptionFromCheckoutSession persistiert den Typ im ok-Pfad", async () => {
  const store = fakeStore();
  const result = await runActivateFromCheckout(store);
  assert.equal(result.ok, true);
  assert.equal(store.state.stripe.paymentMethodType, "card");
});

test("GP-P2: activateSubscriptionFromCheckoutSession persistiert den Typ auch im Heal-Pfad (already_subscribed ohne Karte)", async () => {
  const store = fakeStore();
  store.state.subscription.subscriptionId = CHECKOUT_OUTCOME.subscriptionId;
  const result = await runActivateFromCheckout(store);
  assert.equal(result.reason, "already_subscribed", "der Heal-Zweig lief");
  assert.equal(
    store.state.stripe.paymentMethodType,
    "card",
    "auch die Heilung bindet vollstaendig",
  );
});

const RACE_EVENT = Object.freeze({
  type: SUBSCRIPTION_EVENT.UPDATED,
  data: {
    object: {
      id: "sub_r",
      status: "active",
      customer: "cus_r",
      default_payment_method: "pm_r",
      metadata: { tenant_ref: "t_r" },
    },
  },
});

function webhookDeps({ stripeOnFile, retrieve }) {
  const calls = { stripe: [], retrieve: [] };
  return {
    calls,
    deps: {
      store: {
        findTenantBySubscription: () => null,
        tenantExists: () => true,
        setTenantSubscription: () => {},
        setKycLevel: () => {},
        tenantStripe: () => stripeOnFile,
        setTenantStripe: (tenant, patch) => calls.stripe.push([tenant, patch]),
        tenantSubscription: () => ({ planSlug: null }),
        setProfile: () => ({ profile: {}, changed: [] }),
        setSuspendedAtIfAbsent: () => {},
        clearSuspendedAt: () => {},
        ensureTenant: async () => {},
        clearBillingHold: () => {},
        billingHoldActive: () => null,
        stampBudgetPeriod: () => false,
      },
      accounts: { setStatus: async () => {}, accountByTenant: async () => null },
      sessions: { invalidateByTenant: async () => {} },
      audit: () => {},
      req: {},
      provision: async () => ({ ok: true, reason: "queued" }),
      billing: {
        retrievePaymentMethodType: async (id) => {
          calls.retrieve.push(id);
          return retrieve();
        },
      },
    },
  };
}

test("GP-P2: Webhook-Bindung schlaegt den Typ genau einmal nach und schreibt ihn mit", async () => {
  const { calls, deps } = webhookDeps({
    stripeOnFile: { customerId: "cus_r", paymentMethodId: null, paymentMethodType: null },
    retrieve: () => "card",
  });
  await applyStripeWebhook(RACE_EVENT, deps);
  assert.deepEqual(calls.stripe, [["t_r", { paymentMethodId: "pm_r", paymentMethodType: "card" }]]);
  assert.deepEqual(calls.retrieve, ["pm_r"], "genau ein lesender Anbieter-Aufruf");
});

test("GP-P2: scheitert der Nachschlag, entsteht die Bindung trotzdem - mit unbekanntem Typ, ohne Wurf", async () => {
  const { calls, deps } = webhookDeps({
    stripeOnFile: { customerId: "cus_r", paymentMethodId: null, paymentMethodType: null },
    retrieve: () => {
      throw new Error("Stripe getPaymentMethod fehlgeschlagen: HTTP 500");
    },
  });
  await applyStripeWebhook(RACE_EVENT, deps);
  assert.deepEqual(calls.stripe, [["t_r", { paymentMethodId: "pm_r", paymentMethodType: null }]]);
});

test("GP-P2: Mandant MIT Karte -> weder Nachschlag noch Schreibung (der Aufruf haengt hinter den Bestandsbedingungen)", async () => {
  const { calls, deps } = webhookDeps({
    stripeOnFile: { customerId: "cus_r", paymentMethodId: "pm_bestand", paymentMethodType: "card" },
    retrieve: () => assert.fail("kein Anbieter-Aufruf fuer einen Mandanten mit Karte"),
  });
  await applyStripeWebhook(RACE_EVENT, deps);
  assert.deepEqual(calls.stripe, []);
  assert.equal(calls.retrieve.length, 0);
});

test("GP-P2: der Stale-Customer-Heal loescht auch den Typ (sonst bescheinigt er der naechsten Methode Eignung)", async () => {
  const store = fakeStore({ paymentMethodId: "pm_stale", paymentMethodType: "card" });
  store.state.stripe.customerId = "cus_stale";
  await startCheckoutWithStaleCustomerHeal(
    {
      store,
      billing: { createCustomer: async () => ({ customerId: "cus_fresh" }) },
      tenant: TENANT,
      retryDelayMs: 0,
    },
    async (customerId) => {
      if (customerId === "cus_stale") throw new CustomerMissingError("resource_missing");
      return { url: "ok" };
    },
  );
  assert.equal(store.state.stripe.paymentMethodId, null);
  assert.equal(store.state.stripe.paymentMethodType, null);
});

test("GP-P2: der Typ ueberlebt Flush und frische Hydrierung (Schema + flushTenants + rowToTenant)", async () => {
  const { store, db } = await makePgTestStore();
  const zustand = store.load();
  registerTenant(zustand, TENANT);
  setTenantStripe(zustand, TENANT, {
    customerId: "cus_rt",
    paymentMethodId: "pm_rt",
    paymentMethodType: "card",
  });
  await store.save();

  const runner = {
    withClient: (fn) =>
      fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
  };
  const frisch = makePgStore(runner);
  await frisch.init();
  assert.deepEqual(frisch.tenantStripe(TENANT), {
    customerId: "cus_rt",
    paymentMethodId: "pm_rt",
    paymentMethodType: "card",
  });
});

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const ARGS = { countryCode: "DE", connectionId: "conn_1", holdAmountCents: 92, currency: "eur" };

function tenantMitZahlungsmethode(zustand, { id, paymentMethodType, abo = {} }) {
  registerTenant(zustand, id);
  setTenantStripe(zustand, id, {
    customerId: `cus_${id}`,
    paymentMethodId: `pm_${id}`,
    paymentMethodType,
  });
  if (Object.keys(abo).length) setTenantSubscription(zustand, id, abo);
  return requestNumber(zustand, { tenantId: id, ...CAPS }).number;
}

async function provisioniere({ zustand, number, billing, prov }) {
  return provisionNumber(zustand, { provisioner: prov, billing }, { numberId: number.id, ...ARGS });
}

const geldOperationen = (billing) => billing.log.map((eintrag) => eintrag[0]);

test("GP-P2: 'link' scheitert VOR jedem Anbieter-Kontakt - kein Hold, keine Preis-Suche, Nummer FAILED", async () => {
  const zustand = makeDefaultState();
  const number = tenantMitZahlungsmethode(zustand, { id: "t_link", paymentMethodType: "link" });
  const billing = fakeBilling();
  const prov = fakeProvisioner();
  await assert.rejects(
    () => provisioniere({ zustand, number, billing, prov }),
    (err) => {
      assert.match(err.message, /payment_method_type=link/);
      assert.doesNotMatch(err.message, /insufficient_funds/);
      return true;
    },
  );
  assert.deepEqual(billing.log, [], "kein einziger Geld-Aufruf");
  assert.deepEqual(prov.log, [], "auch die kostenlose Preis-Suche laeuft nicht");
  assert.equal(findNumber(zustand, number.id).status, NUMBER_STATUS.FAILED);
});

test("GP-P2: 'card' laeuft byte-identisch zum Bestand durch (placeHold + captureHold, Nummer ACTIVE)", async () => {
  const zustand = makeDefaultState();
  const number = tenantMitZahlungsmethode(zustand, { id: "t_card", paymentMethodType: "card" });
  const billing = fakeBilling();
  const result = await provisioniere({ zustand, number, billing, prov: fakeProvisioner() });
  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
  assert.deepEqual(geldOperationen(billing), ["placeHold", "captureHold"]);
});

test("GP-P2: ein erfundener Typ faellt durch - Allowlist, nicht Denylist", async () => {
  assert.equal(isHoldCapablePaymentMethodType("xyz_wallet"), false);
  const zustand = makeDefaultState();
  const number = tenantMitZahlungsmethode(zustand, {
    id: "t_unbekannt",
    paymentMethodType: "xyz_wallet",
  });
  const billing = fakeBilling();
  await assert.rejects(
    () => provisioniere({ zustand, number, billing, prov: fakeProvisioner() }),
    /payment_method_type=xyz_wallet/,
  );
  assert.deepEqual(billing.log, []);
});

test("GP-P2: unbekannter Typ (Bestands-Mandant ohne Backfill) faellt fail-closed durch", async () => {
  const zustand = makeDefaultState();
  const number = tenantMitZahlungsmethode(zustand, { id: "t_null", paymentMethodType: null });
  assert.equal(tenantStripe(zustand, "t_null").paymentMethodType, null);
  const billing = fakeBilling();
  await assert.rejects(
    () => provisioniere({ zustand, number, billing, prov: fakeProvisioner() }),
    /payment_method_type=unbekannt/,
  );
  assert.deepEqual(billing.log, []);
  assert.equal(findNumber(zustand, number.id).status, NUMBER_STATUS.FAILED);
});

test("GP-P2: der befreite Mandant (GAP-05) ist nicht ausgenommen - 'link' scheitert vor dem Hold, 'card' laeuft weiter", async () => {
  const zustand = makeDefaultState();
  const abo = { numberSetupFeeExempt: true };
  const schlecht = tenantMitZahlungsmethode(zustand, {
    id: "t_exempt_link",
    paymentMethodType: "link",
    abo,
  });
  const billingSchlecht = fakeBilling();
  await assert.rejects(
    () =>
      provisioniere({
        zustand,
        number: schlecht,
        billing: billingSchlecht,
        prov: fakeProvisioner(),
      }),
    /payment_method_type=link/,
  );
  assert.deepEqual(
    billingSchlecht.log,
    [],
    "GAP-05: der Hold ist das Gate - er wird gar nicht erst gestellt",
  );
  assert.equal(findNumber(zustand, schlecht.id).status, NUMBER_STATUS.FAILED);

  const gut = tenantMitZahlungsmethode(zustand, {
    id: "t_exempt_card",
    paymentMethodType: "card",
    abo,
  });
  const billingGut = fakeBilling();
  const result = await provisioniere({
    zustand,
    number: gut,
    billing: billingGut,
    prov: fakeProvisioner(),
  });
  assert.equal(result.status, NUMBER_STATUS.ACTIVE);
  assert.deepEqual(geldOperationen(billingGut), ["placeHold", "cancelHold"]);
});

test("GP-P2: fehlende Referenz behaelt ihre eigene Bestandsmeldung (zwei Gruende bleiben unterscheidbar)", async () => {
  const zustand = makeDefaultState();
  registerTenant(zustand, "t_ohne");
  setTenantStripe(zustand, "t_ohne", { customerId: "cus_ohne", paymentMethodId: null });
  const number = requestNumber(zustand, { tenantId: "t_ohne", ...CAPS }).number;
  await assert.rejects(
    () => provisioniere({ zustand, number, billing: fakeBilling(), prov: fakeProvisioner() }),
    (err) => {
      assert.match(err.message, /kein hinterlegtes Zahlungsmittel/);
      assert.doesNotMatch(err.message, /payment_method_type/);
      return true;
    },
  );
});

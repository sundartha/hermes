import { test } from "node:test";
import assert from "node:assert/strict";
import * as ops from "../src/store/state-ops.js";
import { KYC_OUTBOUND_MIN } from "../src/store/defaults.js";
import { PAYMENT_METHOD_TYPE_CARD } from "../src/billing/payment-method-eligibility.js";
import { runProvisionRetrySweep } from "../src/billing/provision-retry-sweep.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const TENANT = "t_heil";
const PAYMENT_METHOD = "pm_heil";
const WALLET_TYPE = "link";
const HIGH_CAP = 999;
const MIN_INTERVAL_MS = 86_400_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const NOW_MS = Date.parse("2026-09-15T12:00:00.000Z");

function makeFakeStore(state) {
  let gespeichert = 0;
  const store = {
    load: () => state,
    save() {
      gespeichert += 1;
    },
    async withStoreLock(fn) {
      return fn();
    },
    setTenantStripe(tenantId, patch) {
      ops.setTenantStripe(state, tenantId, patch);
    },
    get saves() {
      return gespeichert;
    },
  };
  return store;
}

function baueState({ paymentMethodType = null, anzahlFailed = 1, mitZahlungsmittel = true } = {}) {
  const state = ops.makeDefaultState();
  ops.registerTenant(state, TENANT);
  ops.setKycLevel(state, TENANT, KYC_OUTBOUND_MIN);
  if (mitZahlungsmittel)
    ops.setTenantStripe(state, TENANT, {
      customerId: "cus_heil",
      paymentMethodId: PAYMENT_METHOD,
      paymentMethodType,
    });
  for (let lauf = 0; lauf < anzahlFailed; lauf += 1) {
    const { number } = ops.requestNumber(state, {
      tenantId: TENANT,
      maxNumbers: HIGH_CAP,
      maxNumbersPerTenant: HIGH_CAP,
    });
    ops.failNumber(state, number.id);
  }
  return state;
}

function makeBillingSpy(antwort) {
  const spy = {
    gefragt: [],
    async retrievePaymentMethodType(paymentMethodId) {
      spy.gefragt.push(paymentMethodId);
      if (antwort instanceof Error) throw antwort;
      return antwort;
    },
  };
  return spy;
}

const CONFIG = withConfigNamespaces({
  provisioningRetryMinIntervalMs: MIN_INTERVAL_MS,
  provisioningRetryMaxAttempts: DEFAULT_MAX_ATTEMPTS,
});

async function fahre({ state, billing, provision = async () => {} }) {
  const anstoesse = [];
  const zaehlenderAnstoss = async (tenantId) => {
    anstoesse.push(tenantId);
    return provision(tenantId);
  };
  const store = makeFakeStore(state);
  await runProvisionRetrySweep({
    store,
    config: CONFIG,
    provision: zaehlenderAnstoss,
    audit: () => {},
    billing,
    nowMs: NOW_MS,
  });
  return { anstoesse, store };
}

test("unbekannter Typ wird im selben Lauf aufgeloest und der Mandant angestossen", async () => {
  const state = baueState({ paymentMethodType: null });
  const billing = makeBillingSpy(PAYMENT_METHOD_TYPE_CARD);
  const { anstoesse } = await fahre({ state, billing });
  assert.deepEqual(billing.gefragt, [PAYMENT_METHOD], "genau eine Abfrage, mit der echten Referenz");
  assert.equal(ops.tenantStripe(state, TENANT).paymentMethodType, PAYMENT_METHOD_TYPE_CARD);
  assert.deepEqual(anstoesse, [TENANT], "nach dem Aufloesen greift der Wiederanlauf sofort");
});

test("aufgeloester Wallet-Typ bleibt ungeeignet - kein Anstoss", async () => {
  const state = baueState({ paymentMethodType: null });
  const billing = makeBillingSpy(WALLET_TYPE);
  const { anstoesse } = await fahre({ state, billing });
  assert.equal(ops.tenantStripe(state, TENANT).paymentMethodType, WALLET_TYPE);
  assert.deepEqual(anstoesse, [], "ein Wallet traegt keinen Hold - auch aufgeloest nicht");
});

test("ein bereits gesetzter Typ wird nie erneut erfragt", async () => {
  const state = baueState({ paymentMethodType: PAYMENT_METHOD_TYPE_CARD });
  const billing = makeBillingSpy(PAYMENT_METHOD_TYPE_CARD);
  await fahre({ state, billing });
  assert.deepEqual(billing.gefragt, [], "keine Abfrage, wenn der Typ schon dasteht");
});

test("ohne gescheiterte Nummer wird gar nicht erst gefragt", async () => {
  const state = baueState({ paymentMethodType: null, anzahlFailed: 0 });
  const billing = makeBillingSpy(PAYMENT_METHOD_TYPE_CARD);
  await fahre({ state, billing });
  assert.deepEqual(billing.gefragt, []);
});

test("ohne hinterlegtes Zahlungsmittel wird gar nicht erst gefragt", async () => {
  const state = baueState({ mitZahlungsmittel: false });
  const billing = makeBillingSpy(PAYMENT_METHOD_TYPE_CARD);
  await fahre({ state, billing });
  assert.deepEqual(billing.gefragt, []);
});

test("Stripe-Fehler: kein Wurf, nichts geschrieben, kein Anstoss", async () => {
  const state = baueState({ paymentMethodType: null });
  const billing = makeBillingSpy(new Error("Stripe unerreichbar"));
  const { anstoesse } = await fahre({ state, billing });
  assert.equal(ops.tenantStripe(state, TENANT).paymentMethodType, null, "nichts geraten");
  assert.deepEqual(anstoesse, []);
});

test("ohne billing-Naht laeuft der Sweep unveraendert weiter", async () => {
  const state = baueState({ paymentMethodType: PAYMENT_METHOD_TYPE_CARD });
  const { anstoesse } = await fahre({ state, billing: null });
  assert.deepEqual(anstoesse, [TENANT]);
});

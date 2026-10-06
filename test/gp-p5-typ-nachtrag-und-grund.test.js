import { test } from "node:test";
import assert from "node:assert/strict";
import * as ops from "../src/store/state-ops.js";
import { KYC_OUTBOUND_MIN } from "../src/store/defaults.js";
import { PAYMENT_METHOD_TYPE_CARD } from "../src/billing/payment-method-eligibility.js";
import { PM_TYPE_OUTCOME, reconcilePaymentMethodTypes } from "../src/billing/payment-method-type-reconcile.js";
import { runProvisionRetrySweep } from "../src/billing/provision-retry-sweep.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const TENANT = "t_gp_p5";
const CUSTOMER = "cus_gp_p5";
const PAYMENT_METHOD = "pm_gp_p5";
const WALLET_TYPE = "link";
const HIGH_CAP = 999;
const DEFAULT_MAX_ATTEMPTS = 3;
const MIN_INTERVAL_MS = 86_400_000;
const NOW_MS = Date.parse("2026-09-15T12:00:00.000Z");

function makeFakeStore(state) {
  return {
    load: () => state,
    save() {},
    async withStoreLock(fn) {
      return fn();
    },
    setTenantStripe(tenantId, patch) {
      ops.setTenantStripe(state, tenantId, patch);
    },
  };
}

function baueState({ paymentMethodType = null, anzahlFailed = 1 } = {}) {
  const state = ops.makeDefaultState();
  ops.registerTenant(state, TENANT);
  ops.setKycLevel(state, TENANT, KYC_OUTBOUND_MIN);
  ops.setTenantStripe(state, TENANT, {
    customerId: CUSTOMER,
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

const stillerLogger = { warn() {}, log() {} };

test("Nachtrag: Trockenlauf meldet den Fund, schreibt aber NICHTS", async () => {
  const state = baueState();
  const report = await reconcilePaymentMethodTypes({
    store: makeFakeStore(state),
    billing: { retrievePaymentMethodType: async () => PAYMENT_METHOD_TYPE_CARD },
    logger: stillerLogger,
  });
  assert.equal(report.scanned, 1);
  assert.deepEqual(report.filled, [{ id: TENANT, paymentMethodType: PAYMENT_METHOD_TYPE_CARD }]);
  assert.equal(ops.tenantStripe(state, TENANT).paymentMethodType, null, "Trockenlauf schreibt nicht");
});

test("Nachtrag: --apply traegt den Typ nach und laesst die Referenz unberuehrt", async () => {
  const state = baueState();
  await reconcilePaymentMethodTypes({
    store: makeFakeStore(state),
    billing: { retrievePaymentMethodType: async () => PAYMENT_METHOD_TYPE_CARD },
    apply: true,
    logger: stillerLogger,
  });
  const stripe = ops.tenantStripe(state, TENANT);
  assert.equal(stripe.paymentMethodType, PAYMENT_METHOD_TYPE_CARD);
  assert.equal(stripe.paymentMethodId, PAYMENT_METHOD, "die Bindung selbst bleibt unveraendert");
  assert.equal(stripe.customerId, CUSTOMER, "der Customer bleibt unveraendert");
});

test("Nachtrag: Stripe-Fehler und Antwort ohne Typ lassen den Mandanten fail-closed unveraendert", async () => {
  for (const billing of [
    { retrievePaymentMethodType: async () => { throw new Error("Stripe unerreichbar"); } },
    { retrievePaymentMethodType: async () => null },
    { retrievePaymentMethodType: async () => "" },
  ]) {
    const state = baueState();
    const report = await reconcilePaymentMethodTypes({
      store: makeFakeStore(state),
      billing,
      apply: true,
      logger: stillerLogger,
    });
    assert.equal(ops.tenantStripe(state, TENANT).paymentMethodType, null, "nichts geraten");
    assert.equal(report.filled.length, 0);
    const gemeldet = [...report.errors, ...report.unknown];
    assert.equal(gemeldet.length, 1);
    assert.ok(
      [PM_TYPE_OUTCOME.LOOKUP_FAILED, PM_TYPE_OUTCOME.UNKNOWN].includes(gemeldet[0].reason),
      `unerwarteter Grund: ${gemeldet[0].reason}`,
    );
  }
});

test("Nachtrag: ein Mandant MIT Typ ist kein Kandidat (kein Ueberschreiben)", async () => {
  const state = baueState({ paymentMethodType: WALLET_TYPE });
  let gefragt = false;
  const report = await reconcilePaymentMethodTypes({
    store: makeFakeStore(state),
    billing: {
      retrievePaymentMethodType: async () => {
        gefragt = true;
        return PAYMENT_METHOD_TYPE_CARD;
      },
    },
    apply: true,
    logger: stillerLogger,
  });
  assert.equal(report.scanned, 0);
  assert.equal(gefragt, false, "ein gesetzter Typ wird nicht erneut erfragt");
  assert.equal(ops.tenantStripe(state, TENANT).paymentMethodType, WALLET_TYPE);
});

test("Nachtrag: nach dem Lauf stoesst der Sweep denselben Mandanten wieder an", async () => {
  const state = baueState();
  const config = withConfigNamespaces({
    provisioningRetryMinIntervalMs: MIN_INTERVAL_MS,
    provisioningRetryMaxAttempts: DEFAULT_MAX_ATTEMPTS,
  });
  const anstoesse = [];
  const provision = async (tenantId) => anstoesse.push(tenantId);

  await runProvisionRetrySweep({ store: makeFakeStore(state), config, provision, audit: () => {}, nowMs: NOW_MS });
  assert.deepEqual(anstoesse, [], "ohne Typ: dauerhaft uebersprungen");

  await reconcilePaymentMethodTypes({
    store: makeFakeStore(state),
    billing: { retrievePaymentMethodType: async () => PAYMENT_METHOD_TYPE_CARD },
    apply: true,
    logger: stillerLogger,
  });
  await runProvisionRetrySweep({ store: makeFakeStore(state), config, provision, audit: () => {}, nowMs: NOW_MS });
  assert.deepEqual(anstoesse, [TENANT], "nach dem Nachtrag laeuft der Wiederanlauf an");
});

test("Sichtbarkeit: die Umfangs-Zeile des Sweeps zaehlt den ungeeigneten Mandanten", async () => {
  const state = baueState({ paymentMethodType: WALLET_TYPE });
  const zeilen = [];
  const echtesLog = console.log;
  console.log = (zeile) => zeilen.push(String(zeile));
  try {
    await runProvisionRetrySweep({
      store: makeFakeStore(state),
      config: withConfigNamespaces({
        provisioningRetryMinIntervalMs: MIN_INTERVAL_MS,
        provisioningRetryMaxAttempts: DEFAULT_MAX_ATTEMPTS,
      }),
      provision: async () => {},
      audit: () => {},
      nowMs: NOW_MS,
    });
  } finally {
    console.log = echtesLog;
  }
  const umfang = zeilen.find((zeile) => zeile.includes("[provision-retry-sweep]"));
  assert.ok(umfang, "die Umfangs-Zeile muss immer kommen");
  assert.match(umfang, /ungeeignet=1/);
});

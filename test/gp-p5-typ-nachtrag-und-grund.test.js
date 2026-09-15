// GP-P5: die drei Luecken, die nach GP-P1..P4 offen blieben.
//
// 1. TYP-NACHTRAG. GP-P2 fuehrte tenant.stripePaymentMethodType additiv ein, ohne
//    Backfill. isHoldCapablePaymentMethodType ist fail-closed, null gilt als ungeeignet -
//    jeder VOR GP-P2 gebundene Mandant faellt damit dauerhaft aus dem automatischen
//    Wiederanlauf (GP-P3/GP-P4), obwohl er zahlt. Belegt am Produktionsbestand
//    (2026-09-15): der Mandant aus dem Vorfall vom 11.09. traegt null.
// 2. SICHTBARKEIT. Genau dieser Ausschluss tauchte in KEINER Zeile des Stunden-Sweeps
//    auf - weder Audit noch Umfangs-Zeile.
// 3. DER GRUND IM DASHBOARD. Der Server kennt die Lage seit GP-P2/P3, die Oberflaeche
//    zeigte nur "Einrichtung der Nummer fehlgeschlagen".
//
// Rein und offline (Muster gp-p4-zeitgesteuerter-wiederanlauf.test.js): Fake-Store,
// kein Server-Spawn, kein pglite, kein Netz.
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
const WALLET_TYPE = "link"; // der reale Typ aus dem Vorfall vom 11.09.2026
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

// Ein zahlender Mandant mit `anzahlFailed` terminal gescheiterten Nummern.
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

// ---- 1. Typ-Nachtrag ---------------------------------------------------------

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

// Die teuerste Fehlentscheidung dieses Bausteins waere ein GERATENER Typ: ein
// faelschlich als 'card' eingetragenes Wallet liesse den Wiederanlauf einen Hold
// versuchen, der strukturell nie gelingen kann - drei Versuche, dann Handbetrieb.
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
    // Der Report muss die beiden Faelle UNTERSCHEIDBAR melden: "Stripe war nicht
    // erreichbar" verlangt einen zweiten Lauf, "Stripe kennt den Typ nicht" nicht.
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

// Der Nachtrag ist kein Selbstzweck: er ist genau der Schritt, der den Mandanten aus
// dem stillen Ausschluss holt. Vorher/Nachher am SELBEN Sweep gemessen.
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

// ---- 2. Sichtbarkeit des dauerhaften Ausschlusses ----------------------------
// Dieser Ausgang liegt HINTER dem 'failed'-Gate und hinter dem Abo-/KYC-Gate: wer ihn
// erreicht, ist ein ZAHLENDER Mandant ohne Nummer, der nie wieder angestossen wird - und
// anders als bei erschoepften Versuchen laeuft dafuer kein Zaehler ueber, der es meldet.
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

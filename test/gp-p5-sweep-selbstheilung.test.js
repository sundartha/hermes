// GP-P5-Selbstheilung: der Stunden-Sweep loest einen UNBEKANNTEN Zahlungsmittel-Typ
// selbst bei Stripe auf, bevor er ueber den Wiederanlauf entscheidet.
//
// Warum das die eigentliche Behebung ist: GP-P2 fuehrte das Typ-Feld additiv ein, ohne
// Backfill; isHoldCapablePaymentMethodType ist fail-closed, null gilt als ungeeignet.
// Damit war JEDER vor GP-P2 gebundene Mandant dauerhaft und lautlos ausgeschlossen - am
// Produktionsbestand (2026-09-15) ALLE drei zahlenden. Ein Nachtrag-Skript haette das
// einmal geheilt; die Luecke selbst bliebe und kehrte beim naechsten Feld dieser Art
// wieder. Der Sweep fragt deshalb selbst nach.
//
// Rein und offline (Muster gp-p4-zeitgesteuerter-wiederanlauf.test.js): Fake-Store,
// Stripe-Naht als Spy, kein Netz.
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

// Stripe-Naht als Spy: zaehlt die Abfragen und merkt sich die gefragte Referenz.
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

// Der Kernfall: ein Bestands-Mandant ohne Typ wird im SELBEN Lauf aufgeloest und
// angestossen - keine zweite Runde, kein Skript, kein Mensch.
test("unbekannter Typ wird im selben Lauf aufgeloest und der Mandant angestossen", async () => {
  const state = baueState({ paymentMethodType: null });
  const billing = makeBillingSpy(PAYMENT_METHOD_TYPE_CARD);
  const { anstoesse } = await fahre({ state, billing });
  assert.deepEqual(billing.gefragt, [PAYMENT_METHOD], "genau eine Abfrage, mit der echten Referenz");
  assert.equal(ops.tenantStripe(state, TENANT).paymentMethodType, PAYMENT_METHOD_TYPE_CARD);
  assert.deepEqual(anstoesse, [TENANT], "nach dem Aufloesen greift der Wiederanlauf sofort");
});

// Die Wahrheit vom Anbieter wird NICHT geschoent: ein Wallet bleibt ungeeignet. Die
// Heilung beantwortet nur die offene Frage, sie aendert das Urteil nicht.
test("aufgeloester Wallet-Typ bleibt ungeeignet - kein Anstoss", async () => {
  const state = baueState({ paymentMethodType: null });
  const billing = makeBillingSpy(WALLET_TYPE);
  const { anstoesse } = await fahre({ state, billing });
  assert.equal(ops.tenantStripe(state, TENANT).paymentMethodType, WALLET_TYPE);
  assert.deepEqual(anstoesse, [], "ein Wallet traegt keinen Hold - auch aufgeloest nicht");
});

// Hoechstens EINE Abfrage je Mandant: nach dem ersten Erfolg ist die Frage beantwortet.
// Sonst waere aus der Heilung ein stuendlicher Rundruf an Stripe geworden.
test("ein bereits gesetzter Typ wird nie erneut erfragt", async () => {
  const state = baueState({ paymentMethodType: PAYMENT_METHOD_TYPE_CARD });
  const billing = makeBillingSpy(PAYMENT_METHOD_TYPE_CARD);
  await fahre({ state, billing });
  assert.deepEqual(billing.gefragt, [], "keine Abfrage, wenn der Typ schon dasteht");
});

// Eng begrenzt: nur wo der unbekannte Typ eine Entscheidung BLOCKIERT. Ein Mandant mit
// laufender Nummer wird nicht angefasst - sonst haette der erste Takt nach dem Deploy
// den ganzen Bestand bei Stripe abgefragt.
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

// Fail-soft in beide Richtungen: ein unerreichbares Stripe darf weder den Lauf reissen
// noch einen Typ erfinden. Der naechste Takt fragt erneut.
test("Stripe-Fehler: kein Wurf, nichts geschrieben, kein Anstoss", async () => {
  const state = baueState({ paymentMethodType: null });
  const billing = makeBillingSpy(new Error("Stripe unerreichbar"));
  const { anstoesse } = await fahre({ state, billing });
  assert.equal(ops.tenantStripe(state, TENANT).paymentMethodType, null, "nichts geraten");
  assert.deepEqual(anstoesse, []);
});

// Ohne billing-Naht (Payment aus, aeltere Verdrahtung) bleibt der Zweig byte-identisch
// zum Bestand - die Heilung ist additiv, keine neue Vorbedingung.
test("ohne billing-Naht laeuft der Sweep unveraendert weiter", async () => {
  const state = baueState({ paymentMethodType: PAYMENT_METHOD_TYPE_CARD });
  const { anstoesse } = await fahre({ state, billing: null });
  assert.deepEqual(anstoesse, [TENANT]);
});

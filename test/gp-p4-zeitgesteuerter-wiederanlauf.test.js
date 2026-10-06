import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeProvisionRetryWatch,
  provisionRetryBucket,
  provisionRetryDue,
  runProvisionRetrySweep,
} from "../src/billing/provision-retry-sweep.js";
import * as ops from "../src/store/state-ops.js";
import { KYC_OUTBOUND_MIN, NEEDS_MANUAL_RECONCILE_REASON } from "../src/store/defaults.js";
import { NUMBER_DISPLAY_STATUS, numberStatusFor } from "../src/store/views.js";
import { PAYMENT_METHOD_TYPE_CARD } from "../src/billing/payment-method-eligibility.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const TENANT = "t_gp_p4";
const CUSTOMER = "cus_gp_p4";
const PAYMENT_METHOD = "pm_gp_p4";
const MIN_INTERVAL_MS = 86_400_000;
const FRIST_TEILER = 2;
const IN_DER_FRIST_MS = MIN_INTERVAL_MS / FRIST_TEILER;
const JENSEITS_DER_FRIST_MS = MIN_INTERVAL_MS + IN_DER_FRIST_MS;
const ZWEITER_ANSTOSS = 2;
const DEFAULT_MAX_ATTEMPTS = 3;
const HIGH_CAP = 999;
const NOW_MS = Date.parse("2026-09-11T12:00:00.000Z");

function makeFakeStore(state) {
  return {
    load: () => state,
    save() {},
    async withStoreLock(fn) {
      return fn();
    },
  };
}

function baueState({
  paymentMethodType = PAYMENT_METHOD_TYPE_CARD,
  kycLevel = KYC_OUTBOUND_MIN,
  anzahlFailed = 1,
} = {}) {
  const state = ops.makeDefaultState();
  ops.registerTenant(state, TENANT);
  if (kycLevel) ops.setKycLevel(state, TENANT, kycLevel);
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

function baueConfig({ minIntervalMs = MIN_INTERVAL_MS, maxAttempts = DEFAULT_MAX_ATTEMPTS } = {}) {
  return withConfigNamespaces({
    provisioningRetryMinIntervalMs: minIntervalMs,
    provisioningRetryMaxAttempts: maxAttempts,
  });
}

function makeProvisionSpy({ wirft = false } = {}) {
  const spy = async () => {
    spy.callCount += 1;
    if (wirft) throw new Error("GP-P4: Provisioning-Naht bewusst kaputt (fail-soft-Probe)");
  };
  spy.callCount = 0;
  return spy;
}

function makeAuditSpy() {
  const eintraege = [];
  const audit = (aktion, _req, zeile) => eintraege.push({ aktion, zeile });
  audit.eintraege = eintraege;
  return audit;
}

async function fahreSweep({ state, provision, audit = makeAuditSpy(), config = baueConfig(), nowMs = NOW_MS }) {
  await runProvisionRetrySweep({ store: makeFakeStore(state), config, provision, audit, nowMs });
  return audit;
}

test("GP-P4: eine nicht hold-faehige Zahlungsmethode ('link') loest keinen Anstoss aus", async () => {
  const state = baueState({ paymentMethodType: "link" });
  const provision = makeProvisionSpy();
  await fahreSweep({ state, provision });
  assert.equal(provision.callCount, 0, "strukturell ungeeignet - der Sweep darf nie kaufen");
  assert.equal(numberStatusFor(state, TENANT), NUMBER_DISPLAY_STATUS.FAILED);
});

test("GP-P4: eine fehlende Zahlungsmethoden-Art (Bestand ohne Typ) loest keinen Anstoss aus (fail-closed)", async () => {
  const state = baueState({ paymentMethodType: null });
  const provision = makeProvisionSpy();
  await fahreSweep({ state, provision });
  assert.equal(provision.callCount, 0, "unbekannter Typ gilt als ungeeignet (GP-P2 Allowlist)");
  assert.equal(numberStatusFor(state, TENANT), NUMBER_DISPLAY_STATUS.FAILED);
});

test("GP-P4: eine hold-faehige Karte mit freiem Versuchszaehler wird angestossen und auditiert", async () => {
  const state = baueState();
  const provision = makeProvisionSpy();
  const audit = await fahreSweep({ state, provision });
  assert.equal(provision.callCount, 1);
  const treffer = audit.eintraege.filter((eintrag) => eintrag.aktion === "provision_retry_sweep");
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0].zeile, `tenant=${TENANT} ausgang=retry versuche=1`);
});

test("GP-P4: ein zweiter Lauf innerhalb der Mindestfrist stoesst NICHT an, ein Lauf danach schon", async () => {
  const state = baueState();
  const store = makeFakeStore(state);
  const provision = makeProvisionSpy();
  const config = baueConfig();
  const lauf = (nowMs) => runProvisionRetrySweep({ store, config, provision, audit: () => {}, nowMs });

  await lauf(NOW_MS);
  assert.equal(provision.callCount, 1, "erster Lauf stoesst an");
  await lauf(NOW_MS + IN_DER_FRIST_MS);
  assert.equal(provision.callCount, 1, "innerhalb der Frist bleibt der Zaehler unveraendert");
  await lauf(NOW_MS + JENSEITS_DER_FRIST_MS);
  assert.equal(provision.callCount, ZWEITER_ANSTOSS, "nach Ablauf der Frist stoesst der Sweep erneut an");
});

test("GP-P4: ein erschoepfter Versuchsdeckel stoesst nicht an und markiert needs_manual_reconcile", async () => {
  const state = baueState({ anzahlFailed: DEFAULT_MAX_ATTEMPTS });
  const provision = makeProvisionSpy();
  const audit = await fahreSweep({ state, provision });
  assert.equal(provision.callCount, 0);
  assert.equal(
    ops.findTenant(state, TENANT).numberProvisionSkipReason,
    NEEDS_MANUAL_RECONCILE_REASON,
  );
  const treffer = audit.eintraege.filter((eintrag) => eintrag.aktion === "provision_retry_sweep");
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0].zeile, `tenant=${TENANT} ausgang=attempts_exhausted versuche=${DEFAULT_MAX_ATTEMPTS}`);
});

test("GP-P4: provisionRetryDue ist rein und pinnt beide Seiten der Frist (kaputter Anker fail-closed)", () => {
  const args = { tenantId: TENANT, nowMs: NOW_MS, minIntervalMs: MIN_INTERVAL_MS };
  const ohneMarker = ops.makeDefaultState();
  assert.equal(provisionRetryDue(ohneMarker, args), true, "nie angestossen -> faellig");

  const setzeMarker = (lastSeenAt) => {
    const state = ops.makeDefaultState();
    ops.claimOutageAlert(state, { code: provisionRetryBucket(TENANT), nowMs: NOW_MS });
    ops.openOutageAlert(state, provisionRetryBucket(TENANT)).lastSeenAt = lastSeenAt;
    return state;
  };

  assert.equal(
    provisionRetryDue(setzeMarker(new Date(NOW_MS - IN_DER_FRIST_MS).toISOString()), args),
    false,
    "innerhalb der Frist -> nicht faellig",
  );
  assert.equal(
    provisionRetryDue(setzeMarker(new Date(NOW_MS - MIN_INTERVAL_MS).toISOString()), args),
    true,
    "exakt auf der Frist -> faellig",
  );
  assert.equal(
    provisionRetryDue(setzeMarker("kaputt"), args),
    false,
    "unlesbarer Zeitanker kauft nichts (fail-closed)",
  );
});

test("GP-P4: minIntervalMs=0 haelt den zeitgesteuerten Zweig komplett aus (kein Anstoss, kein Marker)", async () => {
  const state = baueState();
  const provision = makeProvisionSpy();
  await fahreSweep({ state, provision, config: baueConfig({ minIntervalMs: 0 }) });
  assert.equal(provision.callCount, 0);
  assert.equal(
    ops.openOutageAlert(state, provisionRetryBucket(TENANT)),
    undefined,
    "ein ausgeschalteter Zweig legt keinen Zeitanker an",
  );
});

test("GP-P4: maxAttempts=0 haelt den automatischen Wiederanlauf aus, auch bei positiver Frist", async () => {
  const state = baueState();
  const provision = makeProvisionSpy();
  await fahreSweep({ state, provision, config: baueConfig({ maxAttempts: 0 }) });
  assert.equal(provision.callCount, 0);
  assert.notEqual(
    ops.findTenant(state, TENANT).numberProvisionSkipReason,
    NEEDS_MANUAL_RECONCILE_REASON,
    "0 heisst 'aus', ausdruecklich NICHT 'sofort erschoepft'",
  );
});

test("GP-P4: ein Mandant ohne aktives, verifiziertes Abo wird nie angestossen", async () => {
  const state = baueState({ kycLevel: null });
  const provision = makeProvisionSpy();
  await fahreSweep({ state, provision });
  assert.equal(provision.callCount, 0);
});

test("GP-P4: ein werfender Anstoss bricht den Sweep nicht ab und die Umfangs-Zeile wird geloggt", async () => {
  const state = baueState();
  const provision = makeProvisionSpy({ wirft: true });
  const zeilen = [];
  const originalLog = console.log;
  console.log = (...args) => zeilen.push(args.join(" "));
  try {
    await fahreSweep({ state, provision });
  } finally {
    console.log = originalLog;
  }
  assert.equal(provision.callCount, 1, "der Anstoss lief und warf");
  assert.ok(
    zeilen.some((zeile) => zeile.startsWith("[provision-retry-sweep] geprueft=")),
    `die Umfangs-Zeile muss auch im Fehlerfall stehen: ${zeilen.join("\n")}`,
  );
});

test("GP-P4: makeProvisionRetryWatch liefert runProvisionRetrySweep als Funktion", () => {
  const watch = makeProvisionRetryWatch({
    store: makeFakeStore(ops.makeDefaultState()),
    config: baueConfig({ minIntervalMs: 0 }),
    provision: async () => {},
    audit: () => {},
  });
  assert.equal(typeof watch.runProvisionRetrySweep, "function");
});

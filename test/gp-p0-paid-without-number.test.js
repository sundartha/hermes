import { test } from "node:test";
import assert from "node:assert/strict";
import { paidWithoutNumberCandidates } from "../src/store/state-ops.js";
import {
  runPaidWithoutNumberSweep,
  makePaidWithoutNumberWatch,
  paidWithoutNumberBucket,
} from "../src/billing/paid-without-number-watch.js";
import { TENANT_STATUS, KYC_LEVEL, NUMBER_STATUS, PROVIDER } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const NOW_MS = Date.parse("2026-09-11T12:00:00.000Z");
const GRACE_MS = 3600000;
const SEC = 1000;
const ZWEI_FRISTEN = 2;
const HALBE_FRIST_TEILER = 2;
const periodStartSec = (msVorJetzt) => Math.floor((NOW_MS - msVorJetzt) / SEC);

const tenant = (overrides = {}) => ({
  id: "t1",
  status: TENANT_STATUS.ACTIVE,
  kycLevel: KYC_LEVEL.CARD,
  stripeSubscriptionId: "sub_1",
  stripePlanSlug: "starter",
  stripeCurrentPeriodStart: periodStartSec(ZWEI_FRISTEN * GRACE_MS),
  ...overrides,
});
const nummer = (overrides = {}) => ({
  id: "num1",
  tenantId: "t1",
  status: NUMBER_STATUS.FAILED,
  e164: null,
  provider: PROVIDER.TELNYX,
  providerNumberId: null,
  ...overrides,
});
const state = ({ tenants = [tenant()], numbers = [nummer()], outageAlerts = [] } = {}) => ({
  tenants,
  numbers,
  outageAlerts,
});

const selectCandidates = (testState, graceMs = GRACE_MS) =>
  paidWithoutNumberCandidates(testState, { nowMs: NOW_MS, graceMs, kycMinLevel: KYC_LEVEL.CARD });

test("GP-P0 Selektor: aktiver Subscriber + Nummer failed + aelter als Frist -> GENAU EIN Kandidat", () => {
  const kandidaten = selectCandidates(state());
  assert.equal(kandidaten.length, 1);
  assert.equal(kandidaten[0].tenantId, "t1");
  assert.ok(kandidaten[0].paidSinceIso);
});

test("GP-P0 Selektor Positiv-Kontrolle: Mandant mit AKTIVER Nummer -> NULL Kandidaten", () => {
  const kandidaten = selectCandidates(state({ numbers: [nummer({ status: NUMBER_STATUS.ACTIVE })] }));
  assert.deepEqual(kandidaten, []);
});

test("GP-P0 Selektor: kein aktives Abo (status suspended / kycLevel null) -> NULL Kandidaten", () => {
  assert.deepEqual(selectCandidates(state({ tenants: [tenant({ status: TENANT_STATUS.SUSPENDED })] })), []);
  assert.deepEqual(selectCandidates(state({ tenants: [tenant({ kycLevel: null })] })), []);
});

test("GP-P0 Selektor: Periodenbeginn juenger als die Frist -> NULL Kandidaten", () => {
  const kandidaten = selectCandidates(
    state({ tenants: [tenant({ stripeCurrentPeriodStart: periodStartSec(GRACE_MS / HALBE_FRIST_TEILER) })] }),
  );
  assert.deepEqual(kandidaten, []);
});

test("GP-P0 Selektor: kein Stripe-Anker (Owner/Bootstrap) -> fail-closed NULL Kandidaten", () => {
  const kandidaten = selectCandidates(
    state({
      tenants: [tenant({ stripeCurrentPeriodStart: null, stripeCurrentPeriodEnd: null, stripeSubscriptionId: null })],
    }),
  );
  assert.deepEqual(kandidaten, []);
});

test("GP-P0 Selektor: nur currentPeriodEnd vorhanden -> Anker wird abgeleitet, EIN Kandidat", () => {
  const periodEndSec = periodStartSec(-ZWEI_FRISTEN * GRACE_MS);
  const kandidaten = selectCandidates(
    state({ tenants: [tenant({ stripeCurrentPeriodStart: null, stripeCurrentPeriodEnd: periodEndSec })] }),
  );
  assert.equal(kandidaten.length, 1);
});

function makeStore(initialState) {
  let currentState = initialState;
  return {
    load: () => currentState,
    save: () => {},
    withStoreLock: (fn) => Promise.resolve().then(fn),
    setState: (nextState) => {
      currentState = nextState;
    },
  };
}

function makeAudit(calls) {
  return (action, tenantId, detail) => calls.push({ action, tenantId, detail });
}

const CONFIG = withConfigNamespaces({ paidWithoutNumberGraceMs: GRACE_MS });
const CONFIG_OFF = withConfigNamespaces({ paidWithoutNumberGraceMs: 0 });

test("GP-P0 Sweep: ein Lauf erzeugt GENAU EINEN Befund-Datensatz", async () => {
  const store = makeStore(state());
  const auditCalls = [];
  await runPaidWithoutNumberSweep({ store, config: CONFIG, audit: makeAudit(auditCalls), nowMs: NOW_MS });

  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "paid_without_number");
  const offene = store.load().outageAlerts.filter((alert) => alert.closedAt === null);
  assert.equal(offene.length, 1);
  assert.equal(offene[0].code, paidWithoutNumberBucket("t1"));
});

test("GP-P0 Sweep: zweiter Lauf ohne Zustandsaenderung erzeugt KEINEN weiteren Befund", async () => {
  const store = makeStore(state());
  const auditCalls = [];
  const run = () => runPaidWithoutNumberSweep({ store, config: CONFIG, audit: makeAudit(auditCalls), nowMs: NOW_MS });
  await run();
  await run();

  assert.equal(auditCalls.length, 1);
  assert.equal(store.load().outageAlerts.length, 1);
});

test("GP-P0 Sweep Positiv-Kontrolle: Mandant mit aktiver Nummer -> NULL Audit-Zeilen, NULL Marker", async () => {
  const store = makeStore(state({ numbers: [nummer({ status: NUMBER_STATUS.ACTIVE })] }));
  const auditCalls = [];
  await runPaidWithoutNumberSweep({ store, config: CONFIG, audit: makeAudit(auditCalls), nowMs: NOW_MS });

  assert.equal(auditCalls.length, 0);
  assert.equal(store.load().outageAlerts.length, 0);
});

test("GP-P0 Sweep: Mandant ohne aktives Abo -> NULL Audit-Zeilen, NULL Marker", async () => {
  const store = makeStore(state({ tenants: [tenant({ status: TENANT_STATUS.SUSPENDED })] }));
  const auditCalls = [];
  await runPaidWithoutNumberSweep({ store, config: CONFIG, audit: makeAudit(auditCalls), nowMs: NOW_MS });

  assert.equal(auditCalls.length, 0);
  assert.equal(store.load().outageAlerts.length, 0);
});

test("GP-P0 Sweep: Nummer wird aktiv -> Marker geschlossen, GENAU EINE Erholungs-Zeile; ein dritter Lauf schweigt", async () => {
  const store = makeStore(state());
  const auditCalls = [];
  const run = () => runPaidWithoutNumberSweep({ store, config: CONFIG, audit: makeAudit(auditCalls), nowMs: NOW_MS });
  await run();

  store.setState(
    state({ numbers: [nummer({ status: NUMBER_STATUS.ACTIVE })], outageAlerts: store.load().outageAlerts }),
  );
  await run();

  const marker = store.load().outageAlerts[0];
  assert.notEqual(marker.closedAt, null);
  assert.equal(auditCalls.filter((call) => call.action === "paid_without_number_recovered").length, 1);

  await run();
  assert.equal(auditCalls.filter((call) => call.action === "paid_without_number_recovered").length, 1);
});

test("GP-P0 Sweep: graceMs=0 -> kein Kandidat gelesen, kein Marker, keine Zeile", async () => {
  const store = makeStore(state());
  const auditCalls = [];
  await runPaidWithoutNumberSweep({ store, config: CONFIG_OFF, audit: makeAudit(auditCalls), nowMs: NOW_MS });

  assert.equal(auditCalls.length, 0);
  assert.equal(store.load().outageAlerts.length, 0);
});

test("GP-P0 Sweep: Befund-Zeile ist PII-frei", async () => {
  const store = makeStore(
    state({
      tenants: [tenant({ ownerName: "Erika Mustermann" })],
      numbers: [nummer({ e164: "+493012345000" })],
    }),
  );
  const auditCalls = [];
  await runPaidWithoutNumberSweep({ store, config: CONFIG, audit: makeAudit(auditCalls), nowMs: NOW_MS });

  const detail = auditCalls[0].detail;
  assert.ok(!detail.includes("Erika"));
  assert.ok(!detail.includes("Mustermann"));
  assert.ok(!detail.includes("+493012345000"));
  assert.ok(detail.includes("tenant=t1"));
});

test("GP-P0 Sweep: ein werfender Store bricht den Lauf NICHT ab (fail-soft)", async () => {
  const throwingStore = {
    load: () => {
      throw new Error("gp-p0-store-boom");
    },
    save: () => {},
    withStoreLock: (fn) => Promise.resolve().then(fn),
  };
  const errorLogs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => errorLogs.push(args.map(String).join(" "));
  try {
    await assert.doesNotReject(() =>
      runPaidWithoutNumberSweep({ store: throwingStore, config: CONFIG, audit: () => {}, nowMs: NOW_MS }),
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(errorLogs.length, 1);
  assert.match(errorLogs[0], /gp-p0-store-boom/);
});

test("GP-P0 Fabrik: makePaidWithoutNumberWatch liefert runPaidWithoutNumberSweep als Funktion", () => {
  const watch = makePaidWithoutNumberWatch({ store: makeStore(state()), config: CONFIG_OFF, audit: () => {} });
  assert.equal(typeof watch.runPaidWithoutNumberSweep, "function");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeCostTruing,
  costTruingCoveragePercent,
  SWEEP_TRIGGER,
} from "../src/billing/cost-truing.js";
import { makeDefaultState, createCall } from "../src/store/state-ops.js";
import { COST_TRUING_SOURCE, BOOTSTRAP_TENANT_ID, NUMBER_STATUS } from "../src/store/defaults.js";
import { makeStubStore, fakeConfig, isoMinutesAgo, makeDueOutboundCall, fakeVoiceControl } from "./cost-truing-harness.js";

const MS_PER_MINUTE = 60 * 1000;

const PII_PHONE = "+4915155512345";
const PII_OWNER_NAME = "Maxine Musterfrau";
const PII_TRANSCRIPT_FRAGMENT = "mein Geburtsdatum ist der 3. Januar";

function makeDriftCall(state, { to = "+49", costCts, endedMinutesAgo = 1, tenantId = BOOTSTRAP_TENANT_ID }) {
  const nowMs = Date.now();
  const call = createCall(state, { direction: "outbound", from: "+49", to, tenantId, provider: "telnyx" });
  call.status = "completed";
  call.endedAt = new Date(nowMs - endedMinutesAgo * MS_PER_MINUTE).toISOString();
  call.answeredAt = new Date(nowMs - (endedMinutesAgo + 1) * MS_PER_MINUTE).toISOString();
  call.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  call.costTruedAt = call.endedAt;
  call.actualCostMicroCents = costCts * 1_000_000;
  return call;
}

function makeDriftCalls(state, prefix, costCts, n) {
  return Array.from({ length: n }, (_, i) => makeDriftCall(state, { to: prefix, costCts, endedMinutesAgo: i + 1 }));
}

function withBootstrapNumber(state, { e164 = "+15005550006", provider = "telnyx" } = {}) {
  state.numbers.push({ id: "num_owner", e164, tenantId: BOOTSTRAP_TENANT_ID, provider, status: NUMBER_STATUS.ACTIVE });
  return state;
}

function fakeMessaging() {
  const calls = [];
  const messaging = () => ({
    async sendSms(args) {
      calls.push(args);
      return { sid: "SM_fake" };
    },
  });
  messaging.calls = calls;
  return messaging;
}

function fullRecordSet(legId) {
  return [
    { recordType: "sip-trunking", costMicroCents: 8020000, currency: "USD", billedSec: 120, legId },
    { recordType: "call-control", costMicroCents: 400000, currency: "USD", billedSec: 120, legId },
    { recordType: "speech-to-text", costMicroCents: 0, currency: "USD", billedSec: 120, legId },
    { recordType: "text-to-speech", costMicroCents: 16870, currency: "USD", billedSec: 120, legId },
    { recordType: "recording", costMicroCents: 200000, currency: "USD", billedSec: 120, legId },
  ];
}
const FULL_RECORD_SET_TOTAL_MICRO_CENTS = 8636870;
const FULL_RECORD_TYPES = ["sip-trunking", "call-control", "speech-to-text", "text-to-speech", "recording"];

function fakeCostRecordAdapter(recordsFor, { onFetch = () => {}, poolResult = { ok: true, raw: [], complete: true } } = {}) {
  return {
    async fetchCostRecordPool() {
      onFetch();
      return poolResult;
    },
    assignCostRecords(pool, { legId }) {
      if (!pool.ok) return pool;
      return { ok: true, records: recordsFor(legId) };
    },
  };
}

function collectLogSpies() {
  const logs = [];
  const warns = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args) => logs.push(args.join(" "));
  console.warn = (...args) => warns.push(args.join(" "));
  return {
    logs,
    warns,
    restore() {
      console.log = originalLog;
      console.warn = originalWarn;
    },
  };
}

function auditSpy() {
  const calls = [];
  return { calls, audit: (event, req, detail) => calls.push({ event, req, detail }) };
}

test("(a) zwei beendete Calls, Adapter liefert Records -> actualCostMicroCents gesetzt UND usage byte-identisch", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const legA = "cc_a";
  const legB = "cc_b";
  const callA = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: legA } });
  const callB = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: legB } });
  const store = makeStubStore(state);
  const control = fakeCostRecordAdapter(fullRecordSet);
  const config = fakeConfig();
  const { audit } = auditSpy();
  const { runCostTruingSweep } = makeCostTruing({
    store,
    config,
    voiceControl: fakeVoiceControl({ telnyx: control }),
    audit,
    now: () => nowMs,
  });

  const usageBefore = structuredClone(state.usage);
  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  const usageAfter = structuredClone(state.usage);

  assert.deepStrictEqual(usageAfter, usageBefore, "usage-Map (inkl. costCents/spendMonthCostCents) unveraendert");
  assert.equal(result.skipped, false);
  assert.equal(result.candidates, 2);
  assert.equal(callA.actualCostMicroCents, FULL_RECORD_SET_TOTAL_MICRO_CENTS);
  assert.equal(callB.actualCostMicroCents, FULL_RECORD_SET_TOTAL_MICRO_CENTS);
  assert.equal(callA.costTruedAt !== null, true, "leere Pflicht-Menge schliesst den Call trotzdem ab (measured!==null)");
});

test("(b) Adapter liefert {ok:false} -> costTruedAt bleibt null bis Versuch 5, dann geschlossen; Versuch 6 ruft den Adapter nicht mehr", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs });
  const store = makeStubStore(state);
  let callCount = 0;
  const control = fakeCostRecordAdapter(() => [], {
    onFetch: () => callCount++,
    poolResult: { ok: false, reason: "provider_error" },
  });
  const config = fakeConfig({ costTruingMaxAttempts: 5 });
  const sweepOnFreshInstance = (trigger) =>
    makeCostTruing({
      store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
    }).runCostTruingSweep({ trigger });

  for (let attempt = 1; attempt <= 4; attempt++) {
    await sweepOnFreshInstance(SWEEP_TRIGGER.MANUAL);
    assert.equal(call.costTruedAt, null, `nach Lauf ${attempt}: bleibt offen`);
    assert.equal(call.costTruedSource, COST_TRUING_SOURCE.UNAVAILABLE);
    assert.equal(call.costTruingAttempts, attempt);
  }

  await sweepOnFreshInstance(SWEEP_TRIGGER.MANUAL);
  assert.notEqual(call.costTruedAt, null, "nach Versuch 5 (== MAX_ATTEMPTS) geschlossen");
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.UNAVAILABLE);
  assert.equal(call.costTruingAttempts, 5);
  assert.equal(callCount, 5);

  const result6 = await sweepOnFreshInstance(SWEEP_TRIGGER.MANUAL);
  assert.equal(callCount, 5, "kein sechster Provider-Abruf: der Call ist bereits geschlossen");
  assert.equal(result6.candidates, 0);
});

test("(c) Call endete vor weniger als COST_TRUING_DELAY_MINUTES -> nicht angefasst, Adapter NICHT gerufen", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, endedMinutesAgo: 10 });
  const store = makeStubStore(state);
  let callCount = 0;
  const control = fakeCostRecordAdapter(() => [], { onFetch: () => callCount++ });
  const config = fakeConfig({ costTruingDelayMinutes: 180 });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });

  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(callCount, 0, "Adapter darf fuer einen nicht faelligen Call nicht gerufen werden");
  assert.equal(result.candidates, 0);
  assert.equal(call.costTruedAt, null);
  assert.equal(call.costTruingAttempts, 0);
  assert.equal(call.costTruedSource, null);
});

test("(d) zwei Tenants im Store, je ein faelliger Call -> BEIDE abgeglichen; kein eigenes SQL (Stub ohne query/pool)", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const callTenantA = makeDueOutboundCall(state, { nowMs, tenantId: "tenant_a", legRef: { callControlId: "cc_a" } });
  const callTenantB = makeDueOutboundCall(state, { nowMs, tenantId: "tenant_b", legRef: { callControlId: "cc_b" } });
  const store = makeStubStore(state);
  assert.equal(typeof store.query, "undefined");
  assert.equal(typeof store.pool, "undefined");
  const control = fakeCostRecordAdapter(fullRecordSet);
  const config = fakeConfig();
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });

  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result.candidates, 2);
  assert.notEqual(callTenantA.costTruedAt, null);
  assert.notEqual(callTenantB.costTruedAt, null);
});

test("(e) 20 ct geschaetzt vs. 5 ct gemessen (75% Abweichung) -> genau eine WARN-Zeile, ohne PII", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, {
    nowMs,
    to: PII_PHONE,
    estimatedCostCents: 20,
    legRef: { callControlId: "cc_drift" },
  });
  call.transcript.push({ role: "user", text: PII_TRANSCRIPT_FRAGMENT, at: new Date(nowMs).toISOString() });
  const store = makeStubStore(state);
  const control = fakeCostRecordAdapter((legId) => [
    { recordType: "sip-trunking", costMicroCents: 5_000_000, currency: "USD", billedSec: 60, legId },
  ]);
  const config = fakeConfig({ costDriftWarnPercent: 50, costTruingMinCoveragePercent: 0 });
  const { audit } = auditSpy();
  const spies = collectLogSpies();
  try {
    const { runCostTruingSweep } = makeCostTruing({
      store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit, now: () => nowMs,
    });
    await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  } finally {
    spies.restore();
  }

  const driftWarnings = spies.warns.filter((line) => line.includes("Kosten-Drift"));
  assert.equal(driftWarnings.length, 1, "genau eine Drift-WARN-Zeile");
  const allOutput = [...spies.logs, ...spies.warns].join("\n");
  assert.doesNotMatch(allOutput, new RegExp(PII_PHONE.replace("+", "\\+")), "keine Rufnummer im Log");
  assert.doesNotMatch(allOutput, /Maxine|Musterfrau/, "kein Tenant-Klarname im Log");
  assert.doesNotMatch(allOutput, /Geburtsdatum/, "kein Transkript-Fragment im Log");
});

test("(f) Adapter ohne Beleg-Methoden -> wirft nicht, KEIN Feld geschrieben, skippedCalls zaehlt", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, provider: "twilio", legRef: { twilioSid: "CA_1" } });
  const store = makeStubStore(state);
  const control = {};
  const config = fakeConfig();
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ twilio: control }), audit: () => {}, now: () => nowMs,
  });

  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result.candidates, 1);
  assert.equal(result.skippedCalls, 1);
  assert.equal(store.writes.length, 0, "kein Feld-Schreibvorgang");
  assert.equal(call.costTruingAttempts, 0);
  assert.equal(call.costTruedAt, null);
  assert.equal(call.costTruedSource, null);
});

test("(g) zwei ueberlappende Laeufe (haengender Provider-Call) -> zweiter Lauf ist No-op, Call genau EINMAL verarbeitet", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_g" } });
  const store = makeStubStore(state);
  let callCount = 0;
  let resolvePool;
  const pending = new Promise((resolve) => { resolvePool = resolve; });
  const control = fakeCostRecordAdapter(
    (legId) => [{ recordType: "sip-trunking", costMicroCents: 1000, currency: "USD", billedSec: 60, legId }],
    { onFetch: () => callCount++, poolResult: pending },
  );
  const config = fakeConfig();
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });

  const run1 = runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  const run2 = runCostTruingSweep({ trigger: SWEEP_TRIGGER.INTERVAL });
  const result2 = await run2;
  assert.deepEqual(result2, { skipped: true, reason: "sweep_running" });
  assert.equal(callCount, 1, "der zweite Lauf darf den Adapter nicht (erneut) rufen");

  resolvePool({ ok: true, raw: [], complete: true });
  const result1 = await run1;
  assert.equal(result1.skipped, false);
  assert.equal(callCount, 1, "Adapter insgesamt genau einmal gerufen");
  assert.equal(call.costTruingAttempts, 1, "Attempts steigt um 1, nicht um 2");
  assert.equal(store.writes.length, 1, "genau ein Feld-Schreibvorgang");

  const result3 = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result3.skipped, false);
});

test("(h1) leere COST_TRUING_REQUIRED_RECORD_TYPES -> costTruedSource ist 'incomplete', NIE 'telnyx_detail_records'", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_h1" } });
  const store = makeStubStore(state);
  const control = fakeCostRecordAdapter(fullRecordSet);
  const config = fakeConfig({ costTruingRequiredRecordTypes: [] });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.INCOMPLETE);
});

test("(h2) Gegenprobe: dieselben Records mit ERFUELLTER Pflicht-Menge -> 'telnyx_detail_records'", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_h2" }, estimatedCostCents: 20 });
  const store = makeStubStore(state);
  const control = fakeCostRecordAdapter(fullRecordSet);
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG);
});

test("(h3) Gegenprobe: dieselben Records mit NICHT erfuellter Pflicht-Menge -> 'incomplete'", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_h3" } });
  const store = makeStubStore(state);
  const control = fakeCostRecordAdapter(fullRecordSet);
  const config = fakeConfig({ costTruingRequiredRecordTypes: [...FULL_RECORD_TYPES, "inference"] });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.INCOMPLETE);
});

test("(i) costTruingCoveragePercent: 4 von 5 beendeten Calls BEIDER Richtungen bewiesen -> 80; laufende Calls zaehlen nie; Nenner 0 -> 0 (kein Freispruch, kein NaN)", () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  for (let i = 0; i < 3; i++) {
    const c = makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20, legRef: { callControlId: `cc_proven_${i}` } });
    c.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
    c.costTruedAt = new Date(nowMs).toISOString();
  }
  const unproven = makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20, legRef: { callControlId: "cc_unproven" } });
  unproven.costTruedSource = COST_TRUING_SOURCE.UNAVAILABLE;
  unproven.costTruedAt = new Date(nowMs).toISOString();

  const inbound = createCall(state, { direction: "inbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  inbound.status = "completed";
  inbound.answeredAt = new Date(nowMs).toISOString();
  inbound.endedAt = new Date(nowMs).toISOString();
  inbound.estimatedCostCents = 12;
  inbound.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });

  assert.equal(costTruingCoveragePercent(state), 80, "der beendete, bewiesene Inbound-Call zaehlt in Zaehler UND Nenner");

  const emptyState = makeDefaultState();
  assert.strictEqual(costTruingCoveragePercent(emptyState), 0);
  assert.ok(!Number.isNaN(costTruingCoveragePercent(emptyState)));
  assert.notEqual(costTruingCoveragePercent(emptyState), 100, "Nenner 0 ist KEIN Freispruch");
});

test("(j1) Deckung unter Schwelle -> genau ein Befund je Entprellfenster, PII-frei", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const proven = makeDueOutboundCall(state, { nowMs, to: PII_PHONE, legRef: { callControlId: "cc_j_0" } });
  proven.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  proven.costTruedAt = new Date(nowMs).toISOString();
  for (let i = 1; i < 5; i++) {
    const c = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: `cc_j_${i}` } });
    c.costTruedSource = COST_TRUING_SOURCE.UNAVAILABLE;
    c.costTruedAt = new Date(nowMs).toISOString();
  }
  const store = makeStubStore(state);
  const { calls: auditCalls, audit } = auditSpy();
  let clock = nowMs;
  const config = fakeConfig({
    costTruingMinCoveragePercent: 80, outageAlertDebounceMs: 1000, outageAlertRetryMs: 1000,
    costTruingCoverageStallSweeps: 100,
  });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({}), audit, now: () => clock,
  });

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(auditCalls.filter((c) => c.event === "cost_truing_befund").length, 1, "Sweep 1: genau ein Befund");

  clock += 500;
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(auditCalls.filter((c) => c.event === "cost_truing_befund").length, 1, "Sweep 2 (innerhalb Debounce): kein zweiter Befund");
  assert.equal(
    auditCalls.filter((entry) => entry.event === "cost_truing_befund_entprellt").length, 1,
    "Sweep 2: der entprellte Versand hinterlaesst trotzdem eine Audit-Zeile",
  );

  clock += 1000;
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  const findings = auditCalls.filter((c) => c.event === "cost_truing_befund");
  assert.equal(findings.length, 2, "Sweep 3 (nach Debounce): wieder genau ein Befund");
  for (const f of findings) {
    assert.doesNotMatch(f.detail, new RegExp(PII_PHONE.replace("+", "\\+")), "keine Rufnummer im Befund");
    assert.doesNotMatch(f.detail, /Maxine|Musterfrau/, "kein Tenant-Klarname im Befund");
  }
});

test("(j2) Deckung bleibt COST_TRUING_COVERAGE_STALL_SWEEPS Sweeps unter der Schwelle -> zusaetzlich genau ein coverage_stalled", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const c = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_stall" } });
  c.costTruedSource = COST_TRUING_SOURCE.UNAVAILABLE;
  c.costTruedAt = new Date(nowMs).toISOString();
  const store = makeStubStore(state);
  const { calls: auditCalls, audit } = auditSpy();
  let clock = nowMs;
  const SWEEP_INTERVAL_MS = 1000;
  const config = fakeConfig({
    costTruingMinCoveragePercent: 80, costTruingCoverageStallSweeps: 3,
    costTruingSweepIntervalMs: SWEEP_INTERVAL_MS, outageAlertDebounceMs: 1, outageAlertRetryMs: 1,
  });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({}), audit, now: () => clock,
  });

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  clock += 3 * SWEEP_INTERVAL_MS;
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  const stalled = auditCalls.filter((entry) => entry.detail.includes("coverage_stalled"));
  assert.equal(stalled.length, 1, "genau ein coverage_stalled nach Erreichen der Stall-Grenze");
});

test("(j3) Deckung ueber der Schwelle -> kein Befund, aber die Quote steht im Sweep-Log", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const c = makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20, legRef: { callControlId: "cc_ok" } });
  c.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  c.costTruedAt = new Date(nowMs).toISOString();
  const store = makeStubStore(state);
  const { calls: auditCalls, audit } = auditSpy();
  const config = fakeConfig({ costTruingMinCoveragePercent: 80 });
  const spies = collectLogSpies();
  try {
    const { runCostTruingSweep } = makeCostTruing({
      store, config, voiceControl: fakeVoiceControl({}), audit, now: () => nowMs,
    });
    await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  } finally {
    spies.restore();
  }
  assert.equal(auditCalls.filter((entry) => entry.event === "cost_truing_befund").length, 0);
  assert.ok(spies.logs.some((line) => line.includes("deckung=100%")), "die Quote steht trotzdem im Log");
});

test("(j4) 1.500 Anfragen je Sweep -> genau ein Befund je Entprellfenster (Log + Audit, keine SMS)", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  makeDueOutboundCall(state, { nowMs, to: PII_PHONE, legRef: { callControlId: "cc_p8" } });
  const store = makeStubStore(state);
  const control = fakeCostRecordAdapter(() => [], {
    poolResult: { ok: true, raw: [], complete: true, requests: 1500, pages: 30 },
  });
  const { calls: auditCalls, audit } = auditSpy();
  const messaging = fakeMessaging();
  let clock = nowMs;
  const config = fakeConfig({ costTruingMinCoveragePercent: 0, costAlertDebounceMs: 1000 });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit, messaging, now: () => clock,
  });
  const volumeFindings = () =>
    auditCalls.filter((c) => c.event === "cost_truing_befund" && c.detail.includes("requests_above_threshold"));

  const spies = collectLogSpies();
  try {
    await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
    clock += 500;
    await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  } finally {
    spies.restore();
  }

  assert.equal(volumeFindings().length, 1, "zwei Sweeps im Entprellfenster -> genau ein Befund");
  assert.equal(volumeFindings()[0].detail, "grund=requests_above_threshold anfragen=1500 schwelle=1440");
  const WARN_ZEILEN_JE_NOTIZ_BEFUND = 1 + 1;
  assert.equal(
    spies.warns.filter((l) => l.includes("requests_above_threshold")).length, WARN_ZEILEN_JE_NOTIZ_BEFUND,
    "der Befund steht im Log: die detaillierte Zeile UND die Meldeweg-Klassenzeile, je einmal",
  );
  assert.equal(messaging.calls.length, 0, "kein neuer Alarmweg: der Waechter verschickt keine SMS (PM-7)");
  assert.doesNotMatch(
    volumeFindings()[0].detail, new RegExp(PII_PHONE.replace("+", "\\+")), "keine Rufnummer im Befund",
  );
});

test("(j5) 1.440 Anfragen sind die Schwelle, erst 1.441 ueberschreiten sie", async () => {
  const findingsAt = async (requests) => {
    const nowMs = Date.now();
    const state = makeDefaultState();
    makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_p8_grenze" } });
    const store = makeStubStore(state);
    const control = fakeCostRecordAdapter(() => [], {
      poolResult: { ok: true, raw: [], complete: true, requests, pages: 1 },
    });
    const { calls: auditCalls, audit } = auditSpy();
    const config = fakeConfig({ costTruingMinCoveragePercent: 0 });
    const { runCostTruingSweep } = makeCostTruing({
      store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit, now: () => nowMs,
    });
    const spies = collectLogSpies();
    try {
      await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
    } finally {
      spies.restore();
    }
    return auditCalls.filter((c) => c.detail.includes("requests_above_threshold")).length;
  };

  assert.equal(await findingsAt(1440), 0, "auf der Schwelle ist sie nicht ueberschritten");
  assert.equal(await findingsAt(1441), 1, "eine Anfrage darueber meldet");
});

test("(k) {ok:true, records:[]} -> 'unavailable', actualCostMicroCents bleibt null, Call bleibt offen", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_k" } });
  const store = makeStubStore(state);
  const control = fakeCostRecordAdapter(() => []);
  const config = fakeConfig({ costTruingMaxAttempts: 5 });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.UNAVAILABLE);
  assert.equal(call.actualCostMicroCents, null);
  assert.equal(call.costTruedAt, null, "eine leere Antwort ist keine gemessene Null - der Call bleibt offen");
});

test("(P5-S1) Laufzeit-Ausloeser OHNE Boot: Sweep bei 4facher Tarif-Abweichung -> genau eine Alarmmeldung (Audit + SMS)", async () => {
  const nowMs = Date.now();
  const state = withBootstrapNumber(makeDefaultState());
  makeDriftCalls(state, "+49", 80, 20);
  const store = makeStubStore(state);
  const { calls: auditCalls, audit } = auditSpy();
  const messaging = fakeMessaging();
  const config = fakeConfig({ platformAlertSmsTo: "+491234567890" });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({}), audit, messaging, now: () => nowMs,
  });

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  const driftAudits = auditCalls.filter((c) => c.event === "tarif_drift_befund");
  assert.equal(driftAudits.length, 1, "genau eine Audit-Meldung");
  assert.equal(messaging.calls.length, 1, "genau ein SMS-Versand");
});

test("(P5-S2) Entprellung je Praefix+Code: zweiter Sweep im Fenster -> keine zweite SMS; nach Fensterablauf wieder genau eine", async () => {
  const nowMs = Date.now();
  const state = withBootstrapNumber(makeDefaultState());
  makeDriftCalls(state, "+49", 80, 20);
  const store = makeStubStore(state);
  const { audit } = auditSpy();
  const messaging = fakeMessaging();
  let clock = nowMs;
  const DEBOUNCE_MS = 1000;
  const config = fakeConfig({ costAlertDebounceMs: DEBOUNCE_MS, platformAlertSmsTo: "+491234567890" });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({}), audit, messaging, now: () => clock,
  });

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(messaging.calls.length, 1, "Sweep 1: genau eine SMS");

  clock += 500;
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(messaging.calls.length, 1, "Sweep 2 (innerhalb Debounce): keine zweite SMS");

  clock += DEBOUNCE_MS;
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(messaging.calls.length, 2, "Sweep 3 (nach Debounce): wieder genau eine SMS");
});

test("(P5-S3) insufficient_samples: Log nennt die Stichprobenzahl, sendSms wird NIE aufgerufen", async () => {
  const nowMs = Date.now();
  const state = withBootstrapNumber(makeDefaultState());
  makeDriftCalls(state, "+49", 80, 1);
  const store = makeStubStore(state);
  const { audit } = auditSpy();
  const messaging = fakeMessaging();
  const config = fakeConfig({ platformAlertSmsTo: "+491234567890" });
  const spies = collectLogSpies();
  try {
    const { runCostTruingSweep } = makeCostTruing({
      store, config, voiceControl: fakeVoiceControl({}), audit, messaging, now: () => nowMs,
    });
    await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  } finally {
    spies.restore();
  }
  assert.ok(spies.logs.some((line) => line.includes("stichproben=1")), "Log nennt die Stichprobenzahl");
  assert.equal(messaging.calls.length, 0, "sendSms wird bei insufficient_samples nie aufgerufen");
});

test("(P5-S4) platformAlertSmsTo leer: Audit feuert trotzdem, messaging() wird NIE aufgerufen (T13-Praezedenz)", async () => {
  const nowMs = Date.now();
  const state = withBootstrapNumber(makeDefaultState());
  makeDriftCalls(state, "+49", 80, 20);
  const store = makeStubStore(state);
  const { calls: auditCalls, audit } = auditSpy();
  const messaging = fakeMessaging();
  const config = fakeConfig({ platformAlertSmsTo: "" });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({}), audit, messaging, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(auditCalls.filter((c) => c.event === "tarif_drift_befund").length, 1, "Audit feuert trotzdem");
  assert.equal(messaging.calls.length, 0, "messaging() wird nie aufgerufen");
});

test("(P5-S5) keine aktive Bootstrap-Nummer: kein SMS, kein Wurf, Sweep-Rueckgabe unveraendert", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  makeDriftCalls(state, "+49", 80, 20);
  const store = makeStubStore(state);
  const { audit } = auditSpy();
  const messaging = fakeMessaging();
  const config = fakeConfig({ platformAlertSmsTo: "+491234567890" });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({}), audit, messaging, now: () => nowMs,
  });
  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result.skipped, false);
  assert.equal(messaging.calls.length, 0, "keine aktive Bootstrap-Nummer -> kein Versand");
});

test("(P5-S6a) sendSms rejectet asynchron -> Sweep laeuft durch, kein unhandled rejection", async () => {
  const nowMs = Date.now();
  const state = withBootstrapNumber(makeDefaultState());
  makeDriftCalls(state, "+49", 80, 20);
  const store = makeStubStore(state);
  const { audit } = auditSpy();
  const rejectingMessaging = () => ({
    async sendSms() {
      throw new Error("provider_down");
    },
  });
  const config = fakeConfig({ platformAlertSmsTo: "+491234567890" });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({}), audit, messaging: rejectingMessaging, now: () => nowMs,
  });
  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result.skipped, false, "Sweep laeuft trotz asynchron rejectendem SMS-Versand durch");
});

test("(P5-S6b) messaging() wirft synchron -> Sweep laeuft durch, kein unhandled rejection", async () => {
  const nowMs = Date.now();
  const state = withBootstrapNumber(makeDefaultState());
  makeDriftCalls(state, "+49", 80, 20);
  const store = makeStubStore(state);
  const { audit } = auditSpy();
  const throwingMessaging = () => {
    throw new Error("unbekannter provider");
  };
  const config = fakeConfig({ platformAlertSmsTo: "+491234567890" });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({}), audit, messaging: throwingMessaging, now: () => nowMs,
  });
  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result.skipped, false, "Sweep laeuft trotz synchronem Wurf durch");
});

test("(P5-S7) usage/spendMonth und Sweep-Rueckgabe bleiben byte-identisch (negativer Beweis der Phase)", async () => {
  const nowMs = Date.now();
  const state = withBootstrapNumber(makeDefaultState());
  makeDriftCalls(state, "+49", 80, 20);
  const store = makeStubStore(state);
  const { audit } = auditSpy();
  const messaging = fakeMessaging();
  const config = fakeConfig({ platformAlertSmsTo: "+491234567890" });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({}), audit, messaging, now: () => nowMs,
  });
  const usageBefore = structuredClone(state.usage);
  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  const usageAfter = structuredClone(state.usage);
  assert.deepStrictEqual(usageAfter, usageBefore, "usage-Map inkl. costCents/spendMonthCostCents unveraendert");
  assert.deepStrictEqual(
    Object.keys(result).sort(),
    [
      "candidates", "coveragePercent",
      "coverageNoEstimate", "coverageNeverAnswered", "coverageOutsideWindow",
      "failed", "incomplete", "measured", "noEstimate", "skipped", "skippedCalls", "unavailable",
    ].sort(),
    "Sweep-Rueckgabe traegt genau die bekannten Zaehler/Quoten-Felder (noEstimate seit der LCT-P4-Korrektur)",
  );
});

// LCT P3 (Kosten-Abgleich im Beobachtungsmodus): Unit-Test fuer src/billing/cost-truing.js.
// In-process, netzfrei, KEIN Server-Spawn (Muster test/metering-unit.test.js +
// test/call-actual-cost-roundtrip.test.js). Der Stub-Store nutzt das ECHTE
// makeDefaultState()/createCall-Shape (state-ops.js) und delegiert
// recordCallCostTruingResult an die ECHTE state-ops-Funktion - das prueft den Sweep UND
// den Idempotenz-Riegel der Store-Schreibfunktion in einem Zug, ohne Datei/DB.
//
// Der Beweis dieser Phase ist NEGATIV: nach einem Lauf sind usage.costCents und
// spendMonthCostCents byte-identisch (Fall a). Alle anderen Faelle pinnen die Riegel, die
// diese Aussage tragen (Idempotenz, Nebenlaeufigkeit, leere Pflicht-Menge, Deckungsquote).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeCostTruing,
  costTruingCoveragePercent,
  SWEEP_TRIGGER,
} from "../src/billing/cost-truing.js";
import {
  makeDefaultState,
  createCall,
  recordCallCostTruingResult,
} from "../src/store/state-ops.js";
import { COST_TRUING_SOURCE, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const MS_PER_MINUTE = 60 * 1000;

// PII-Fixturen fuer die "keine Rufnummer/kein Tenant-Klarname/kein Transkript-Fragment
// im Log"-Assertion (e, j). Bewusst unrealistisch markant, damit ein versehentlicher Leak
// nicht in generischen Zahlen untergeht.
const PII_PHONE = "+4915155512345";
const PII_OWNER_NAME = "Maxine Musterfrau";
const PII_TRANSCRIPT_FRAGMENT = "mein Geburtsdatum ist der 3. Januar";

// ---- Stub-Store (Muster metering-unit.test.js: faengt Schreibzugriffe in einem Array) ----
// store.load() liefert den ECHTEN state-Spiegel; recordCallCostTruingResult delegiert an
// die ECHTE state-ops-Funktion (kein zweites, vereinfachtes Store-Mock-Verhalten). Die
// Stub hat BEWUSST keine query/pool/client-Methode (Fall d: der Sweep darf nie eigenes
// SQL absetzen - ein Aufruf einer solchen Methode waere ein TypeError).
function makeStubStore(state) {
  const writes = [];
  return {
    state,
    writes,
    load() {
      return state;
    },
    recordCallCostTruingResult(callId, outcome) {
      const { call, changed } = recordCallCostTruingResult(state, callId, outcome);
      if (changed) writes.push({ callId, outcome });
      return call;
    },
  };
}

// Konfig-Fixture fuer die sieben P3-Felder (billing-Namespace). Jeder Test ueberschreibt
// nur, was er wirklich pruefen will (F1: Default-Objekt statt loser Argumente).
function fakeConfig(overrides = {}) {
  return withConfigNamespaces({
    costTruingDelayMinutes: 180,
    costTruingMaxAttempts: 5,
    costTruingRequiredRecordTypes: [],
    costTruingMinCoveragePercent: 80,
    costTruingCoverageStallSweeps: 8,
    costDriftWarnPercent: 50,
    costAlertDebounceMs: 24 * 60 * 60 * 1000,
    ...overrides,
  });
}

function isoMinutesAgo(nowMs, minutes) {
  return new Date(nowMs - minutes * MS_PER_MINUTE).toISOString();
}

// Ein beendeter Outbound-Call, faellig fuer den Abgleich (endedAt lange genug her).
// legRef waehlt twilioSid ODER callControlId (providerLegIdOf: twilioSid || callControlId).
function makeDueOutboundCall(state, { nowMs, tenantId = BOOTSTRAP_TENANT_ID, provider = "telnyx", legRef = { callControlId: "cc_1" }, endedMinutesAgo = 200, estimatedCostCents = null, to = "+49" } = {}) {
  const call = createCall(state, { direction: "outbound", from: "+49", to, tenantId, provider });
  call.status = "completed";
  call.answeredAt = isoMinutesAgo(nowMs, endedMinutesAgo + 1);
  call.endedAt = isoMinutesAgo(nowMs, endedMinutesAgo);
  if (legRef.callControlId) call.callControlId = legRef.callControlId;
  if (legRef.twilioSid) call.twilioSid = legRef.twilioSid;
  if (estimatedCostCents !== null) call.estimatedCostCents = estimatedCostCents;
  return call;
}

function fakeVoiceControl(byProvider) {
  return (provider) => {
    const impl = byProvider[provider];
    if (!impl) throw new Error(`Provider '${provider}' fuer Port 'voiceControl' nicht unterstuetzt`);
    return impl;
  };
}

// Vollstaendig aussehende Records (5 Typen), Betraege aus der Live-Messung vom 2026-07-20
// (parseDecimalToMicroCents-Ausgabe: 0.0802->8020000, 0.004->400000, 0.0000->0,
// 1.687E-4->16870, 0.002->200000). Summe = 8636870 Mikro-Cent (USD).
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

// ---- (a) Der eigentliche Beweis: usage.costCents/spendMonthCostCents byte-identisch ----

test("(a) zwei beendete Calls, Adapter liefert Records -> actualCostMicroCents gesetzt UND usage byte-identisch", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const legA = "cc_a";
  const legB = "cc_b";
  const callA = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: legA } });
  const callB = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: legB } });
  const store = makeStubStore(state);
  const control = {
    async getVoiceCostRecords({ legId }) {
      return { ok: true, records: fullRecordSet(legId) };
    },
  };
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

// ---- (b) {ok:false} -> offen bis MAX_ATTEMPTS, dann geschlossen als 'unavailable' ----

test("(b) Adapter liefert {ok:false} -> costTruedAt bleibt null bis Versuch 5, dann geschlossen; Versuch 6 ruft den Adapter nicht mehr", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs });
  const store = makeStubStore(state);
  let callCount = 0;
  const control = {
    async getVoiceCostRecords() {
      callCount++;
      return { ok: false, reason: "provider_error" };
    },
  };
  const config = fakeConfig({ costTruingMaxAttempts: 5 });
  // JEDER Lauf bekommt eine FRISCHE makeCostTruing-Instanz (simuliert einen Prozess-
  // Restart zwischen den Sweeps, Render-Free-Tier). Das ist der einzige Weg, der einen
  // In-Memory- von einem PERSISTIERTEN Versuchszaehler unterscheidet: ein In-Memory-
  // Zaehler lebt im Closure-Scope von makeCostTruing und wuerde bei jeder Neuinstanzierung
  // auf 0 zurueckfallen (Instanz + Store gleichzeitig wiederzuverwenden haette diesen Bug
  // nicht gefangen - beide Zaehlarten waeren ununterscheidbar geblieben).
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

  await sweepOnFreshInstance(SWEEP_TRIGGER.MANUAL); // Versuch 5
  assert.notEqual(call.costTruedAt, null, "nach Versuch 5 (== MAX_ATTEMPTS) geschlossen");
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.UNAVAILABLE);
  assert.equal(call.costTruingAttempts, 5);
  assert.equal(callCount, 5);

  const result6 = await sweepOnFreshInstance(SWEEP_TRIGGER.MANUAL); // Versuch 6
  assert.equal(callCount, 5, "kein sechster Provider-Abruf: der Call ist bereits geschlossen");
  assert.equal(result6.candidates, 0);
});

// ---- (c) noch nicht faellig (Aufschub) -> unangefasst, Adapter nicht gerufen ----

test("(c) Call endete vor weniger als COST_TRUING_DELAY_MINUTES -> nicht angefasst, Adapter NICHT gerufen", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, endedMinutesAgo: 10 }); // < 180 Min
  const store = makeStubStore(state);
  let callCount = 0;
  const control = { async getVoiceCostRecords() { callCount++; return { ok: true, records: [] }; } };
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

// ---- (d) zwei Tenants -> beide abgeglichen (RLS-Schleifen-Regression) ----

test("(d) zwei Tenants im Store, je ein faelliger Call -> BEIDE abgeglichen; kein eigenes SQL (Stub ohne query/pool)", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const callTenantA = makeDueOutboundCall(state, { nowMs, tenantId: "tenant_a", legRef: { callControlId: "cc_a" } });
  const callTenantB = makeDueOutboundCall(state, { nowMs, tenantId: "tenant_b", legRef: { callControlId: "cc_b" } });
  const store = makeStubStore(state);
  assert.equal(typeof store.query, "undefined");
  assert.equal(typeof store.pool, "undefined");
  const control = {
    async getVoiceCostRecords({ legId }) {
      return { ok: true, records: fullRecordSet(legId) };
    },
  };
  const config = fakeConfig();
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });

  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result.candidates, 2);
  assert.notEqual(callTenantA.costTruedAt, null);
  assert.notEqual(callTenantB.costTruedAt, null);
});

// ---- (e) Drift-WARN: genau eine Zeile, PII-frei ----

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
  const control = {
    async getVoiceCostRecords({ legId }) {
      return { ok: true, records: [{ recordType: "sip-trunking", costMicroCents: 5_000_000, currency: "USD", billedSec: 60, legId }] };
    },
  };
  // costTruingMinCoveragePercent=0: isoliert die Drift-WARN von der Deckungs-WARN (Fall j).
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

// ---- (f) Adapter ohne getVoiceCostRecords (Twilio-Form) -> sauberer No-op ----

test("(f) Adapter ohne getVoiceCostRecords -> wirft nicht, KEIN Feld geschrieben, skippedCalls zaehlt", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, provider: "twilio", legRef: { twilioSid: "CA_1" } });
  const store = makeStubStore(state);
  const control = {}; // Twilio-Form: keine getVoiceCostRecords-Methode
  const config = fakeConfig();
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ twilio: control }), audit: () => {}, now: () => nowMs,
  });

  // Ruft direkt auf (statt assert.doesNotReject, das den Erfuellungswert nicht
  // durchreicht) - ein unerwarteter Wurf liesse den Test ohnehin rot werden.
  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result.candidates, 1);
  assert.equal(result.skippedCalls, 1);
  assert.equal(store.writes.length, 0, "kein Feld-Schreibvorgang");
  assert.equal(call.costTruingAttempts, 0);
  assert.equal(call.costTruedAt, null);
  assert.equal(call.costTruedSource, null);
});

// ---- (g) echte Nebenlaeufigkeit: Laufriegel ----

test("(g) zwei ueberlappende Laeufe (haengender Provider-Call) -> zweiter Lauf ist No-op, Call genau EINMAL verarbeitet", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_g" } });
  const store = makeStubStore(state);
  let callCount = 0;
  let resolveRecords;
  const pending = new Promise((resolve) => { resolveRecords = resolve; });
  const control = {
    async getVoiceCostRecords() {
      callCount++;
      return pending;
    },
  };
  const config = fakeConfig();
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });

  // KEIN await zwischen run1 und run2: run2 startet in der Luecke, waehrend run1 auf dem
  // haengenden Provider-Promise wartet.
  const run1 = runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  const run2 = runCostTruingSweep({ trigger: SWEEP_TRIGGER.INTERVAL });
  const result2 = await run2;
  assert.deepEqual(result2, { skipped: true, reason: "sweep_running" });
  assert.equal(callCount, 1, "der zweite Lauf darf den Adapter nicht (erneut) rufen");

  resolveRecords({ ok: true, records: [{ recordType: "sip-trunking", costMicroCents: 1000, currency: "USD", billedSec: 60, legId: "cc_g" }] });
  const result1 = await run1;
  assert.equal(result1.skipped, false);
  assert.equal(callCount, 1, "Adapter insgesamt genau einmal gerufen");
  assert.equal(call.costTruingAttempts, 1, "Attempts steigt um 1, nicht um 2");
  assert.equal(store.writes.length, 1, "genau ein Feld-Schreibvorgang");

  // Ein dritter Lauf NACH Abschluss laeuft wieder normal (der Riegel klemmt nicht dauerhaft).
  const result3 = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result3.skipped, false);
});

// ---- (h) leere Pflicht-Menge: nie 'telnyx_detail_records'; Gegenproben ----

test("(h1) leere COST_TRUING_REQUIRED_RECORD_TYPES -> costTruedSource ist 'incomplete', NIE 'telnyx_detail_records'", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_h1" } });
  const store = makeStubStore(state);
  const control = { async getVoiceCostRecords({ legId }) { return { ok: true, records: fullRecordSet(legId) }; } };
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
  const call = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_h2" } });
  const store = makeStubStore(state);
  const control = { async getVoiceCostRecords({ legId }) { return { ok: true, records: fullRecordSet(legId) }; } };
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.DETAIL_RECORDS);
});

test("(h3) Gegenprobe: dieselben Records mit NICHT erfuellter Pflicht-Menge -> 'incomplete'", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_h3" } });
  const store = makeStubStore(state);
  const control = { async getVoiceCostRecords({ legId }) { return { ok: true, records: fullRecordSet(legId) }; } };
  const config = fakeConfig({ costTruingRequiredRecordTypes: [...FULL_RECORD_TYPES, "inference"] });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.INCOMPLETE);
});

// ---- (i) costTruingCoveragePercent: reine Projektion ----

test("(i) costTruingCoveragePercent: 3 von 4 beendeten Outbound-Calls bewiesen -> 75; Nenner 0 -> 0 (kein Freispruch, kein NaN)", () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  for (let i = 0; i < 3; i++) {
    const c = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: `cc_proven_${i}` } });
    c.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
    c.costTruedAt = new Date(nowMs).toISOString();
  }
  const unproven = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_unproven" } });
  unproven.costTruedSource = COST_TRUING_SOURCE.UNAVAILABLE;
  unproven.costTruedAt = new Date(nowMs).toISOString();

  // Zusatz: Inbound- und noch laufende Calls zaehlen in KEINER der beiden Achsen.
  const inbound = createCall(state, { direction: "inbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  inbound.status = "completed";
  inbound.endedAt = new Date(nowMs).toISOString();
  inbound.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID }); // endedAt bleibt null

  assert.equal(costTruingCoveragePercent(state), 75);

  const emptyState = makeDefaultState();
  assert.strictEqual(costTruingCoveragePercent(emptyState), 0);
  assert.ok(!Number.isNaN(costTruingCoveragePercent(emptyState)));
  assert.notEqual(costTruingCoveragePercent(emptyState), 100, "Nenner 0 ist KEIN Freispruch");
});

// ---- (j) Sichtbarkeit: Debounce + Terminierungsregel ----

test("(j1) Deckung unter Schwelle -> genau ein Befund je Entprellfenster, PII-frei", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  // 1 von 5 bewiesen = 20% < 80%. Alle Calls bereits abgeschlossen (keine Kandidaten mehr) -
  // isoliert die Deckungs-Meldung vom Sweep-Verarbeitungspfad.
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
  const config = fakeConfig({ costTruingMinCoveragePercent: 80, costAlertDebounceMs: 1000, costTruingCoverageStallSweeps: 100 });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({}), audit, now: () => clock,
  });

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(auditCalls.filter((c) => c.event === "cost_truing_befund").length, 1, "Sweep 1: genau ein Befund");

  clock += 500; // innerhalb des Entprellfensters (1000ms)
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(auditCalls.filter((c) => c.event === "cost_truing_befund").length, 1, "Sweep 2 (innerhalb Debounce): kein zweiter Befund");

  clock += 1000; // Fenster jetzt abgelaufen (1500ms seit Sweep 1)
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
  c.costTruedSource = COST_TRUING_SOURCE.UNAVAILABLE; // 0% Deckung
  c.costTruedAt = new Date(nowMs).toISOString();
  const store = makeStubStore(state);
  const { calls: auditCalls, audit } = auditSpy();
  let clock = nowMs;
  const DEBOUNCE_MS = 100;
  const config = fakeConfig({ costTruingMinCoveragePercent: 80, costAlertDebounceMs: DEBOUNCE_MS, costTruingCoverageStallSweeps: 3 });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({}), audit, now: () => clock,
  });

  for (let sweep = 1; sweep <= 3; sweep++) {
    await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
    clock += DEBOUNCE_MS + 1; // jedes Fenster erneut ablaufen lassen
  }
  const stalled = auditCalls.filter((entry) => entry.detail.includes("coverage_stalled"));
  assert.equal(stalled.length, 1, "genau ein coverage_stalled nach Erreichen der Stall-Grenze");
});

test("(j3) Deckung ueber der Schwelle -> kein Befund, aber die Quote steht im Sweep-Log", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const c = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_ok" } });
  c.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS; // 100% Deckung
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

// ---- (k) leere Records-Antwort ist keine gemessene Null ----

test("(k) {ok:true, records:[]} -> 'unavailable', actualCostMicroCents bleibt null, Call bleibt offen", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_k" } });
  const store = makeStubStore(state);
  const control = { async getVoiceCostRecords() { return { ok: true, records: [] }; } };
  const config = fakeConfig({ costTruingMaxAttempts: 5 });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.UNAVAILABLE);
  assert.equal(call.actualCostMicroCents, null);
  assert.equal(call.costTruedAt, null, "eine leere Antwort ist keine gemessene Null - der Call bleibt offen");
});

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
import { makeDefaultState, createCall } from "../src/store/state-ops.js";
import { COST_TRUING_SOURCE, BOOTSTRAP_TENANT_ID, NUMBER_STATUS } from "../src/store/defaults.js";
import { makeStubStore, fakeConfig, isoMinutesAgo, makeDueOutboundCall, fakeVoiceControl } from "./cost-truing-harness.js";

const MS_PER_MINUTE = 60 * 1000;

// PII-Fixturen fuer die "keine Rufnummer/kein Tenant-Klarname/kein Transkript-Fragment
// im Log"-Assertion (e, j). Bewusst unrealistisch markant, damit ein versehentlicher Leak
// nicht in generischen Zahlen untergeht.
const PII_PHONE = "+4915155512345";
const PII_OWNER_NAME = "Maxine Musterfrau";
const PII_TRANSCRIPT_FRAGMENT = "mein Geburtsdatum ist der 3. Januar";

// makeStubStore/fakeConfig/isoMinutesAgo/makeDueOutboundCall kommen aus cost-truing-harness.js
// (KE-P2, G5) - byte-identisch zum frueheren lokalen Stand hier.

// LCT P5: ein bereits abgeglichener Drift-Sample-Call (costTruedSource/costTruedAt schon
// gesetzt) - KEIN Truing-Kandidat (isTruingCandidate verlangt costTruedAt===null), taucht
// aber in reportTariffDrift() auf (das liest state.calls unabhaengig vom Truing-Status).
// minutes fest auf 1 (answeredAt einen Takt vor endedAt) - costCts entspricht direkt der
// USD-Cent/min-Rate.
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

// LCT P5: n Drift-Sample-Calls mit distinkten endedAt-Zeitpunkten (Kollisionsvermeidung).
function makeDriftCalls(state, prefix, costCts, n) {
  return Array.from({ length: n }, (_, i) => makeDriftCall(state, { to: prefix, costCts, endedMinutesAgo: i + 1 }));
}

// LCT P5: aktive Bootstrap-Nummer im Store - der Absender des Drift-Alarms. Ohne sie
// (P5-S5) sendet sendDriftAlertSms fail-closed keine SMS.
function withBootstrapNumber(state, { e164 = "+15005550006", provider = "telnyx" } = {}) {
  state.numbers.push({ id: "num_owner", e164, tenantId: BOOTSTRAP_TENANT_ID, provider, status: NUMBER_STATUS.ACTIVE });
  return state;
}

// LCT P5: Fake-Messaging-Registry (Muster fakeVoiceControl) - zaehlt sendSms-Aufrufe,
// sendet NIEMALS echt (Test-Disziplin: kein Test loest eine echte SMS aus).
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

// KE-P2: der Port ist zweigeteilt - EIN Pool-Abruf je Sweep, danach je Call eine SYNCHRONE
// Zuordnung. recordsFor(legId) spielt genau die Rolle, die frueher getVoiceCostRecords({legId})
// hatte; onFetch zaehlt die Pool-Abrufe (frueher: die Adapter-Aufrufe je Kandidat).
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

// ---- (a) Der eigentliche Beweis: usage.costCents/spendMonthCostCents byte-identisch ----

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

// ---- (b) {ok:false} -> offen bis MAX_ATTEMPTS, dann geschlossen als 'unavailable' ----

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

// ---- (d) zwei Tenants -> beide abgeglichen (RLS-Schleifen-Regression) ----

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
  const control = fakeCostRecordAdapter((legId) => [
    { recordType: "sip-trunking", costMicroCents: 5_000_000, currency: "USD", billedSec: 60, legId },
  ]);
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

// ---- (f) Adapter ohne Beleg-Methoden -> sauberer No-op ----

test("(f) Adapter ohne Beleg-Methoden -> wirft nicht, KEIN Feld geschrieben, skippedCalls zaehlt", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, provider: "twilio", legRef: { twilioSid: "CA_1" } });
  const store = makeStubStore(state);
  const control = {}; // Control-Objekt ohne fetchCostRecordPool/assignCostRecords (beide OPTIONAL am Port)
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

  // KEIN await zwischen run1 und run2: run2 startet in der Luecke, waehrend run1 auf dem
  // haengenden Provider-Promise wartet.
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
  // estimatedCostCents muss buchbar sein (>= 0): ohne Schaetzbetrag klassifiziert
  // truedSourceOf seit P8 unbedingt als NO_ESTIMATE (kein Flag-Kurzschluss mehr, der bei
  // fehlendem Estimate den rohen measured.source durchreicht) - dieser Test prueft aber
  // gezielt die Klassifikation bei ERFUELLTER Pflicht-Menge, nicht den Estimate-Zustand.
  const call = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_h2" }, estimatedCostCents: 20 });
  const store = makeStubStore(state);
  const control = fakeCostRecordAdapter(fullRecordSet);
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
  const control = fakeCostRecordAdapter(fullRecordSet);
  const config = fakeConfig({ costTruingRequiredRecordTypes: [...FULL_RECORD_TYPES, "inference"] });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.INCOMPLETE);
});

// ---- (i) costTruingCoveragePercent: reine Projektion ----

// KV-P3 DREHT DIE ZUSAGE DIESES TESTS, bewusst und mit Begruendung: bis KV-P3 filterte
// die Quote auf direction === "outbound" und zaehlte einen beendeten Inbound-Call in
// KEINER Achse. Seit KV-P3 ist der Ist-Abgleich richtungsoffen (die Schaetzung aus KV-P2
// bliebe sonst dauerhaft rund 3,5x ueber dem Ist stehen), und Nenner UND Zaehler folgen
// derselben EINEN Quelle isEndedCall. Der beendete Inbound-Call zaehlt jetzt in BEIDEN.
// Was UNVERAENDERT gilt und deshalb hier stehen bleibt: ein noch LAUFENDER Call
// (endedAt === null) zaehlt in keiner Achse - das ist die Zusage, die diese Phase NICHT
// anfasst.
// KV-M3: seit dieser Phase zusaetzlich mit buchbarer Schaetzung UND answeredAt, sonst
// waere keiner der Calls im (jetzt engeren) Nenner - createCall setzt answeredAt NICHT
// automatisch (anders als makeDueOutboundCall aus dem Harness).
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

  // Ein beendeter, BEWIESENER Inbound-Call zaehlt seit KV-P3 in Zaehler UND Nenner.
  const inbound = createCall(state, { direction: "inbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  inbound.status = "completed";
  inbound.answeredAt = new Date(nowMs).toISOString();
  inbound.endedAt = new Date(nowMs).toISOString();
  inbound.estimatedCostCents = 12;
  inbound.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  // Ein noch LAUFENDER Call (endedAt bleibt null) zaehlt weiterhin in KEINER Achse.
  createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });

  assert.equal(costTruingCoveragePercent(state), 80, "der beendete, bewiesene Inbound-Call zaehlt in Zaehler UND Nenner");

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
  // KV2-1: die VOLL-Stufe (coverage_below_threshold) entprellt seit dieser Phase am
  // durablen Marker (outageAlertDebounceMs/-RetryMs), nicht mehr an costAlertDebounceMs.
  const config = fakeConfig({
    costTruingMinCoveragePercent: 80, outageAlertDebounceMs: 1000, outageAlertRetryMs: 1000,
    costTruingCoverageStallSweeps: 100,
  });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({}), audit, now: () => clock,
  });

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(auditCalls.filter((c) => c.event === "cost_truing_befund").length, 1, "Sweep 1: genau ein Befund");

  clock += 500; // innerhalb des Entprellfensters (1000ms)
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(auditCalls.filter((c) => c.event === "cost_truing_befund").length, 1, "Sweep 2 (innerhalb Debounce): kein zweiter Befund");
  // KV2-1 Kriterium (b): ein entprellter VOLL-Befund faellt auf die Notiz-Stufe zurueck
  // (meldeBetreiberNotiz) statt ganz zu schweigen - "nie stumm" gilt fuer JEDEN Lauf.
  assert.equal(
    auditCalls.filter((entry) => entry.event === "cost_truing_befund_entprellt").length, 1,
    "Sweep 2: der entprellte Versand hinterlaesst trotzdem eine Audit-Zeile",
  );

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
  // KV2-1: die Stall-Terminierung laeuft seit dieser Phase in ZEIT (firstSeenAt am
  // durablen Marker), nicht mehr ueber einen prozesslokalen Sweep-Zaehler - gemessen wird
  // also gegen costTruingCoverageStallSweeps * costTruingSweepIntervalMs.
  // outageAlertDebounceMs/-RetryMs klein, damit jeder Sweep erneut melden darf.
  const SWEEP_INTERVAL_MS = 1000;
  const config = fakeConfig({
    costTruingMinCoveragePercent: 80, costTruingCoverageStallSweeps: 3,
    costTruingSweepIntervalMs: SWEEP_INTERVAL_MS, outageAlertDebounceMs: 1, outageAlertRetryMs: 1,
  });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({}), audit, now: () => clock,
  });

  // Erster Sweep bei t0 (nur coverage_below_threshold moeglich - noch nichts "seit"
  // laenger als die Stall-Schwelle her). Zweiter Sweep NACH der Stall-Schwelle: erst dann
  // ist sie ueberschritten -> zusaetzlich coverage_stalled.
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  clock += 3 * SWEEP_INTERVAL_MS; // == costTruingCoverageStallSweeps oben
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  const stalled = auditCalls.filter((entry) => entry.detail.includes("coverage_stalled"));
  assert.equal(stalled.length, 1, "genau ein coverage_stalled nach Erreichen der Stall-Grenze");
});

test("(j3) Deckung ueber der Schwelle -> kein Befund, aber die Quote steht im Sweep-Log", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  // KV-M3: estimatedCostCents noetig, sonst waere der Call ohne Schaetzung und faellt
  // aus dem (jetzt engeren) Nenner - die Quote waere 0%, nicht 100%.
  const c = makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20, legRef: { callControlId: "cc_ok" } });
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

// ---- (j4/j5) KE-P8: Bruchpunkt-Waechter auf DEMSELBEN entprellten Befundkanal ----
//
// Gemeldet wird fetchTally.requests - genau das Feld, das die Sweep-Zeile als anfragen=
// ausgibt. Dass diese Zahl ECHTE HTTP-Anfragen zaehlt und keine zweite Buchhaltung ist,
// pinnt (P6-8) in test/cost-truing-sweep-log.test.js gegen den echten Adapter. Hier wird
// deshalb am PORT gestubbt (requests/pages stehen laut ports.js auf JEDER Antwortform):
// 1441 echte Anfragen muessten sonst durch die Drossel (30/min), also durch 48 Minuten.

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
  // costTruingMinCoveragePercent: 0 isoliert den neuen Befund von der Deckungs-Meldung -
  // sonst zaehlte diese Zusage zwei Sachverhalte auf einem Label.
  const config = fakeConfig({ costTruingMinCoveragePercent: 0, costAlertDebounceMs: 1000 });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: control }), audit, messaging, now: () => clock,
  });
  const volumeFindings = () =>
    auditCalls.filter((c) => c.event === "cost_truing_befund" && c.detail.includes("requests_above_threshold"));

  const spies = collectLogSpies();
  try {
    await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
    clock += 500; // zweiter Sweep INNERHALB des Entprellfensters (1000 ms)
    await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  } finally {
    spies.restore();
  }

  assert.equal(volumeFindings().length, 1, "zwei Sweeps im Entprellfenster -> genau ein Befund");
  assert.equal(volumeFindings()[0].detail, "grund=requests_above_threshold anfragen=1500 schwelle=1440");
  // KV2-1: seit dieser Phase laeuft die Notiz-Stufe ueber den Betreiber-Meldeweg
  // (meldeBetreiberNotiz), der SELBST eine eigene, knappe WARN-Zeile schreibt
  // ("[outage] cost_truing_befund klasse=kosten:requests_above_threshold") - zusaetzlich
  // zur bestehenden detaillierten Zeile ("[cost-truing] Befund grund=..."). Beide Zeilen
  // enthalten den Code-String, deshalb ZWEI statt EIN Treffer - genau EIN Sendevorgang
  // bleibt es trotzdem (volumeFindings().length oben, messaging.calls.length unten).
  const WARN_ZEILEN_JE_NOTIZ_BEFUND = 1 + 1; // detaillierte Zeile + Meldeweg-Klassenzeile
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
    // FRISCHE Instanz je Lauf: eigene Entprell-Map, die beiden Faelle sind unabhaengig.
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

// ---- (k) leere Records-Antwort ist keine gemessene Null ----

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

// ---- (P5) LCT P5 (Drift-Waechter): Laufzeit-Ausloeser + Entprellung + Alarmkanal ----

test("(P5-S1) Laufzeit-Ausloeser OHNE Boot: Sweep bei 4facher Tarif-Abweichung -> genau eine Alarmmeldung (Audit + SMS)", async () => {
  const nowMs = Date.now();
  const state = withBootstrapNumber(makeDefaultState());
  makeDriftCalls(state, "+49", 80, 20); // 4x konfigurierter Tarif (20 ct) -> underestimate
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

  clock += 500; // innerhalb des Entprellfensters
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(messaging.calls.length, 1, "Sweep 2 (innerhalb Debounce): keine zweite SMS");

  clock += DEBOUNCE_MS; // Fenster jetzt abgelaufen
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(messaging.calls.length, 2, "Sweep 3 (nach Debounce): wieder genau eine SMS");
});

test("(P5-S3) insufficient_samples: Log nennt die Stichprobenzahl, sendSms wird NIE aufgerufen", async () => {
  const nowMs = Date.now();
  const state = withBootstrapNumber(makeDefaultState());
  makeDriftCalls(state, "+49", 80, 1); // 1 Sample, weit unter minSamples (20)
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
  const state = makeDefaultState(); // KEINE Nummer im Store
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
      // KV-M3: die drei Nebenzaehler des (jetzt engeren) Deckungsquote-Nenners.
      "coverageNoEstimate", "coverageNeverAnswered", "coverageOutsideWindow",
      "failed", "incomplete", "measured", "noEstimate", "skipped", "skippedCalls", "unavailable",
    ].sort(),
    "Sweep-Rueckgabe traegt genau die bekannten Zaehler/Quoten-Felder (noEstimate seit der LCT-P4-Korrektur)",
  );
});

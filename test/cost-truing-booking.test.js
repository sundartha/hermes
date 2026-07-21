// LCT P4 (Der Flip): Sweep-Ebene der Korrekturbuchung in src/billing/cost-truing.js.
// Muster test/cost-truing-observe.test.js: In-process, netzfrei, KEIN Server-Spawn. Der
// Stub-Store nutzt das ECHTE makeDefaultState()/createCall-Shape UND delegiert
// applyCostCorrectionCents an die ECHTE state-ops-Funktion (kein zweites, vereinfachtes
// Store-Mock-Verhalten - Muster recordCallCostTruingResult im Vorbild).
//
// Kurs NEUTRAL (1_000_000): haelt die Fixturen als Cent direkt lesbar (die
// Kurs-Arithmetik selbst ist test/usage-correction-booking.test.js Fall f/j vorbehalten).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCostTruing, SWEEP_TRIGGER, costTruingCoveragePercent } from "../src/billing/cost-truing.js";
import {
  makeDefaultState,
  createCall,
  recordCallCostTruingResult,
  applyCostCorrectionCents,
  usageFor,
} from "../src/store/state-ops.js";
import { COST_TRUING_SOURCE, BOOTSTRAP_TENANT_ID, emptyUsage } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const MS_PER_MINUTE = 60 * 1000;
const NEUTRAL_RATE = 1_000_000;
const FULL_RECORD_TYPES = ["sip-trunking", "call-control", "speech-to-text", "text-to-speech", "recording"];

// ---- Stub-Store (Muster cost-truing-observe.test.js) ----
// applyCostCorrectionCents delegiert an die ECHTE state-ops-Funktion (2-Arg-Fassade wie
// json.js/pg.js: tenantId + input, nowIso wird HIER an der IO-Grenze erzeugt).
function makeStubStore(state, { nowMs = Date.now() } = {}) {
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
    applyCostCorrectionCents(tenantId, input) {
      return applyCostCorrectionCents(state, tenantId, input, new Date(nowMs).toISOString());
    },
  };
}

function fakeConfig(overrides = {}) {
  return withConfigNamespaces({
    costTruingDelayMinutes: 180,
    costTruingMaxAttempts: 5,
    costTruingRequiredRecordTypes: [],
    costTruingMinCoveragePercent: 80,
    costTruingCoverageStallSweeps: 8,
    costDriftWarnPercent: 50,
    costAlertDebounceMs: 24 * 60 * 60 * 1000,
    voiceTariffDomesticCents: 20,
    voiceTariffDefaultCents: 300,
    voiceTariffDomesticPrefixes: ["+49", "+33", "+44"],
    providerToBucketRateMicro: NEUTRAL_RATE,
    costCalibrationMinSamples: 20,
    platformAlertSmsTo: "",
    ...overrides,
  });
}

function isoMinutesAgo(nowMs, minutes) {
  return new Date(nowMs - minutes * MS_PER_MINUTE).toISOString();
}

function makeDueOutboundCall(
  state,
  {
    nowMs,
    tenantId = BOOTSTRAP_TENANT_ID,
    provider = "telnyx",
    legId = "cc_1",
    endedMinutesAgo = 200,
    estimatedCostCents = null,
    to = "+49",
  } = {},
) {
  const call = createCall(state, { direction: "outbound", from: "+49", to, tenantId, provider });
  call.status = "completed";
  call.answeredAt = isoMinutesAgo(nowMs, endedMinutesAgo + 3); // 3-Minuten-Call
  call.endedAt = isoMinutesAgo(nowMs, endedMinutesAgo);
  call.callControlId = legId;
  if (estimatedCostCents !== null) call.estimatedCostCents = estimatedCostCents;
  return call;
}

// Records mit GENAU EINEM nicht-leeren Betrag (auf dem ersten Typ), Rest 0 - Summe ist
// damit exakt totalMicroCents, unabhaengig von der Typ-Anzahl.
function recordsWithTotal(types, totalMicroCents, { billedSec = 120, legId = "cc_1" } = {}) {
  return types.map((t, i) => ({
    recordType: t,
    costMicroCents: i === 0 ? totalMicroCents : 0,
    currency: "USD",
    billedSec,
    legId,
  }));
}

function seedUsageCents(state, tenantId, costCents) {
  state.usage[tenantId] = { ...emptyUsage(), costCents };
}

function control(records) {
  return { async getVoiceCostRecords() { return { ok: true, records }; } };
}

function voiceControl(impl) {
  return () => impl;
}

// ---- (a) Ist < Schaetzung, VOLLSTAENDIGE Datenlage -> Korrektur gebucht ----

test("(a) Ist 5ct < Schaetzung 20ct, vollstaendige Records -> costCents 100->85", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, 100);
  makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20 });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control(recordsWithTotal(FULL_RECORD_TYPES, 5_000_000))),
    audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, 85);
});

// ---- (b) Ist < Schaetzung, Records decken die Pflicht-Menge NICHT ab -> KEINE Korrektur ----

test("(b) DER WICHTIGSTE TEST: Ist < Schaetzung, Pflicht-Menge NICHT abgedeckt ('incomplete') -> costCents unveraendert", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, 100);
  makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20 });
  const store = makeStubStore(state, { nowMs });
  // Records tragen nur EINEN der fuenf Pflicht-Typen -> 'incomplete'.
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control(recordsWithTotal(["sip-trunking"], 5_000_000))),
    audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, 100, "keine Rueckerstattung ohne Vollstaendigkeitsbeweis");
});

// ---- (c) Ist > Schaetzung -> BEDINGUNGSLOS gebucht, auch bei 'incomplete' ----

test("(c) Ist 20ct > Schaetzung 5ct, Quelle 'incomplete' -> trotzdem gebucht (bedingungslos geheilt)", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, 100);
  makeDueOutboundCall(state, { nowMs, estimatedCostCents: 5 });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control(recordsWithTotal(["sip-trunking"], 20_000_000))),
    audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, 115, "Unterschaetzung wird IMMER geheilt");
});

// ---- (h) Idempotenz: zweiter sequenzieller Sweep bucht nicht doppelt ----

test("(h) zwei sequenzielle Sweeps ueber denselben Call -> zweiter Lauf: kandidaten=0, costCents unveraendert", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, 100);
  makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20 });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control(recordsWithTotal(FULL_RECORD_TYPES, 5_000_000))),
    audit: () => {}, now: () => nowMs,
  });
  const result1 = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result1.candidates, 1);
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, 85);

  const result2 = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(result2.candidates, 0, "der Call ist bereits costTruedAt!==null -> kein Kandidat mehr");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, 85, "keine doppelte Buchung");
});

// ---- (i) Korrektur gegen den PERSISTIERTEN estimatedCostCents, NIE gegen tariffCentsPerMin ----

test("(i) ein GEAENDERTER Tarif in der Config aendert die Korrektur NICHT - sie rechnet gegen estimatedCostCents=18, nicht gegen 3min*25ct", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, 100);
  makeDueOutboundCall(state, { nowMs, estimatedCostCents: 18 });
  const store = makeStubStore(state, { nowMs });
  // voiceTariffDomesticCents=25 ist eine ABLENKUNG: wuerde die Korrektur (fehlerhaft) den
  // Tarif neu anwenden (3 Min * 25 = 75ct), ergaebe sich 16-75=-59 -> costCents=41.
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES, voiceTariffDomesticCents: 25 });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control(recordsWithTotal(FULL_RECORD_TYPES, 16_000_000))),
    audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, 98, "Korrektur -2 (16-18), NICHT -59");
});

// ---- (k) frei definierte Pflicht-Menge, teilweise abgedeckt -> keine Korrektur ----

test("(k) Pflicht-Menge ['typ-a','typ-b'] im Test selbst gesetzt, Records tragen nur 'typ-a' -> costCents unveraendert", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, 100);
  makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20 });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: ["typ-a", "typ-b"] });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control(recordsWithTotal(["typ-a"], 5_000_000))),
    audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, 100);
});

// ---- (l) kein persistierter Schaetzbetrag (Bestandszeile) -> eigener Zustand NO_ESTIMATE ----
// Vollstaendige Records (measured.source = 'telnyx_detail_records'), aber estimatedCostCents=null.
// Der Call ist strukturell nicht korrigierbar - das ist KEIN Messproblem ('incomplete') und
// KEINE bewiesene Deckung ('telnyx_detail_records'), sondern ein eigener Sachverhalt. Die
// Sweep-Bilanz muss GENAU das zaehlen, was persistiert wird: nicht 'gemessen', sondern
// 'ohne_schaetzung'. (LCT-P4-Korrektur: zwei Sachverhalte teilen sich NICHT ein Label.)
test("(l) estimatedCostCents=null (Bestandszeile), Records vollstaendig -> costTruedSource='no_estimate', Bilanz gemessen=0/ohne_schaetzung=1, keine Buchung", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, 100);
  const call = makeDueOutboundCall(state, { nowMs }); // estimatedCostCents bleibt null
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control(recordsWithTotal(FULL_RECORD_TYPES, 5_000_000))),
    audit: () => {}, now: () => nowMs,
  });
  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(
    call.costTruedSource,
    COST_TRUING_SOURCE.NO_ESTIMATE,
    "vollstaendige Records ohne Schaetzbetrag -> eigener Zustand, NIE 'incomplete' oder 'telnyx_detail_records'",
  );
  assert.equal(result.measured, 0, "ein als NO_ESTIMATE persistierter Call darf in der Bilanz NIE als 'gemessen' erscheinen");
  assert.equal(result.noEstimate, 1, "er wird im eigenen NO_ESTIMATE-Zaehler gefuehrt");
  assert.equal(result.incomplete, 0, "kein Messproblem -> nicht 'incomplete'");
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, 100, "kein Schaetzbetrag -> keine Korrektur gebucht");
  assert.notEqual(call.costTruedAt, null, "Records lagen vor -> der Call ist abgeschlossen (kein weiterer Versuch)");
});

// ---- (p) Deckungsquote unveraendert: NO_ESTIMATE drueckt die Quote GENAU so wie zuvor
// 'incomplete' (beide sind nicht 'telnyx_detail_records', also nicht-proven) ----
test("(p) costTruingCoveragePercent: NO_ESTIMATE und 'incomplete' druecken die Quote identisch (Bestandszeile bleibt nicht-proven)", () => {
  const nowMs = Date.now();
  const withNoEstimate = makeDefaultState();
  makeDueOutboundCall(withNoEstimate, { nowMs }).costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  makeDueOutboundCall(withNoEstimate, { nowMs, legId: "cc_2" }).costTruedSource = COST_TRUING_SOURCE.NO_ESTIMATE;

  const withIncomplete = makeDefaultState();
  makeDueOutboundCall(withIncomplete, { nowMs }).costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  makeDueOutboundCall(withIncomplete, { nowMs, legId: "cc_2" }).costTruedSource = COST_TRUING_SOURCE.INCOMPLETE;

  assert.equal(costTruingCoveragePercent(withNoEstimate), 50, "1 von 2 beweisbar vollstaendig");
  assert.equal(
    costTruingCoveragePercent(withNoEstimate),
    costTruingCoveragePercent(withIncomplete),
    "die Quote ist identisch, ob die Bestandszeile 'incomplete' (alt) oder NO_ESTIMATE (neu) heisst",
  );
});

// ---- (m) leere Pflicht-Menge: Allquantor-Falle bleibt geschlossen ----

test("(m) costTruingRequiredRecordTypes=[] (leer), vollstaendig aussehende Records -> costCents unveraendert", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, 100);
  makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20 });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: [] });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control(recordsWithTotal(FULL_RECORD_TYPES, 5_000_000))),
    audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, 100, "leere Menge beweist NICHTS - 'incomplete', nie 'telnyx_detail_records'");
});

// ---- billedSec-Riegel: vollstaendige Typ-Menge, aber billedSec=0 -> nichts beweist Abrechnung ----

test("billedSec-Riegel: alle Pflicht-Typen vorhanden, aber billedSec=0 fuer alle Records -> costCents unveraendert", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, 100);
  makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20 });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const { runCostTruingSweep } = makeCostTruing({
    store, config,
    voiceControl: voiceControl(control(recordsWithTotal(FULL_RECORD_TYPES, 5_000_000, { billedSec: 0 }))),
    audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, 100, "Records ohne abgerechnete Sekunden beweisen nichts");
});

// ---- Rest end-to-end: ein verworfener Lauf laesst den Korrektur-Rest bit-gleich ----

test("Rest end-to-end: verworfener Lauf (k-Fixtur) laesst costCorrectionMicroCentsRem unveraendert", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, 100);
  makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20 });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: ["typ-a", "typ-b"] });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control(recordsWithTotal(["typ-a"], 5_000_000))),
    audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCorrectionMicroCentsRem, 0, "verworfener Lauf ruehrt den Rest nicht an");
});

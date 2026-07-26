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
import { makeDefaultState, createCall, usageFor, budgetExceeded, setTenantBudget } from "../src/store/state-ops.js";
import { COST_TRUING_SOURCE, BOOTSTRAP_TENANT_ID, emptyUsage } from "../src/store/defaults.js";
import { makeStubStore, fakeConfig, isoMinutesAgo } from "./cost-truing-harness.js";

const FULL_RECORD_TYPES = ["sip-trunking", "call-control", "speech-to-text", "text-to-speech", "recording"];

// makeStubStore/fakeConfig/isoMinutesAgo kommen aus cost-truing-harness.js (KE-P2, G5) -
// byte-identisch zum frueheren lokalen Stand hier; providerToBucketRateMicro=1_000_000 ist
// dort bereits der Default (die "neutrale" Rate dieser Datei).
//
// makeDueOutboundCall/voiceControl bleiben BEWUSST lokal (keine Vereinheitlichung mit
// cost-truing-observe.test.js): dieser 3-Minuten-Call mit String-legId ist Teil der
// Tarif-Drift-Fixturen dieser Datei - eine Verschmelzung waere ein Verhaltensrisiko in
// einem Geld-Test, ohne Nutzen fuer KE-P2.
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

// KE-P2: der Port ist zweigeteilt - der Pool-Abruf liefert hier immer eine leere,
// vollstaendige Huelle (raw:[]), records ordnet assignCostRecords unmittelbar zu (die
// eigentliche Zuordnungslogik ist NICHT Pruefgegenstand dieser Datei, s. Header-Kommentar).
function control(records) {
  return {
    async fetchCostRecordPool() {
      return { ok: true, raw: [], complete: true };
    },
    assignCostRecords() {
      return { ok: true, records };
    },
  };
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

// ---- PAY-06: der Sweep befreit die ueberbuchte Decke (Gate-Wirkung, nicht nur Bucket) ----
// Umformuliert nach R-G (Begruendung im Blockreport): der Katalog unterstellt, der Sweep
// befreie die RESERVE. Gemessen befreit die Reserve releaseOutboundReserve bei Call-Ende;
// der Sweep korrigiert die zu hoch GEBUCHTE Schaetzung - und erst nach
// costTruingDelayMinutes. Genau das ist die Decken-Befreiung, die der Katalog meint, und
// sie ist als GATE-Wirkung ungepinnt: Test (a) oben prueft die Bucket-ZAHL, hier steht das
// Gate-PRAEDIKAT budgetExceeded.
const PAY06_CAP_CENTS = 300; // Tenant-Decke
const PAY06_ESTIMATE_CENTS = 400; // Worst-Case-Ueberbuchung, liegt UEBER der Decke
const PAY06_MEASURED_MICRO_CENTS = 90_000_000; // 90 ct Ist -> nach Korrektur wieder unter der Decke

// Baut den ueberbuchten Ausgangszustand: Decke 300 ct, gebuchte Schaetzung 400 ct.
// Liefert alles, was beide Faelle unten brauchen (Build-Operate-Check, P13).
function seedOverbookedTenant(nowMs, { endedMinutesAgo }) {
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, PAY06_ESTIMATE_CENTS);
  setTenantBudget(state, BOOTSTRAP_TENANT_ID, {
    budgetCents: PAY06_CAP_CENTS,
    hardCapCents: PAY06_CAP_CENTS,
  });
  makeDueOutboundCall(state, { nowMs, endedMinutesAgo, estimatedCostCents: PAY06_ESTIMATE_CENTS });
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const { runCostTruingSweep } = makeCostTruing({
    store: makeStubStore(state, { nowMs }),
    config,
    voiceControl: voiceControl(control(recordsWithTotal(FULL_RECORD_TYPES, PAY06_MEASURED_MICRO_CENTS))),
    audit: () => {},
    now: () => nowMs,
  });
  return { state, config, runCostTruingSweep };
}

test("PAY-06: der Sweep gibt die ueberbuchte Decke frei - budgetExceeded kippt von true auf false", async () => {
  const nowMs = Date.now();
  // 200 Minuten her > costTruingDelayMinutes (180 in fakeConfig) -> faellig.
  const { state, config, runCostTruingSweep } = seedOverbookedTenant(nowMs, { endedMinutesAgo: 200 });
  assert.equal(
    budgetExceeded(state, BOOTSTRAP_TENANT_ID, config),
    true,
    "Vorbedingung: die Worst-Case-Schaetzung sperrt den Tenant (400 >= 300)",
  );

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, 90, "auf den Ist-Betrag korrigiert");
  assert.equal(
    budgetExceeded(state, BOOTSTRAP_TENANT_ID, config),
    false,
    "die Decke ist wieder frei - ohne diese Freigabe bliebe der Tenant fuer eine ueberschaetzte Buchung gesperrt",
  );
});

test("PAY-06: ein noch NICHT faelliger Call laesst die Decke gesperrt (die Verzoegerung wirkt)", async () => {
  const nowMs = Date.now();
  // 10 Minuten her < costTruingDelayMinutes (180) -> noch kein Kandidat.
  const { state, config, runCostTruingSweep } = seedOverbookedTenant(nowMs, { endedMinutesAgo: 10 });

  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(result.candidates, 0, "vor Ablauf der Verzoegerung ist der Call kein Kandidat");
  assert.equal(
    usageFor(state, BOOTSTRAP_TENANT_ID).costCents,
    PAY06_ESTIMATE_CENTS,
    "die Schaetzung bleibt unangetastet",
  );
  assert.equal(
    budgetExceeded(state, BOOTSTRAP_TENANT_ID, config),
    true,
    "und die Decke bleibt gesperrt",
  );
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

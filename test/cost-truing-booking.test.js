import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCostTruing, SWEEP_TRIGGER, costTruingCoveragePercent } from "../src/billing/cost-truing.js";
import { makeDefaultState, createCall, usageFor, budgetExceeded, setTenantBudget } from "../src/store/state-ops.js";
import { COST_TRUING_SOURCE, BOOTSTRAP_TENANT_ID, emptyUsage } from "../src/store/defaults.js";
import { makeStubStore, fakeConfig, isoMinutesAgo } from "./cost-truing-harness.js";

const FULL_RECORD_TYPES = ["sip-trunking", "call-control", "speech-to-text", "text-to-speech", "recording"];

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
  call.answeredAt = isoMinutesAgo(nowMs, endedMinutesAgo + 3);
  call.endedAt = isoMinutesAgo(nowMs, endedMinutesAgo);
  call.callControlId = legId;
  if (estimatedCostCents !== null) call.estimatedCostCents = estimatedCostCents;
  return call;
}

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

test("(b) DER WICHTIGSTE TEST: Ist < Schaetzung, Pflicht-Menge NICHT abgedeckt ('incomplete') -> costCents unveraendert", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, 100);
  makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20 });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control(recordsWithTotal(["sip-trunking"], 5_000_000))),
    audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, 100, "keine Rueckerstattung ohne Vollstaendigkeitsbeweis");
});

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

const PAY06_CAP_CENTS = 300;
const PAY06_ESTIMATE_CENTS = 400;
const PAY06_MEASURED_MICRO_CENTS = 90_000_000;

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

test("(i) ein GEAENDERTER Tarif in der Config aendert die Korrektur NICHT - sie rechnet gegen estimatedCostCents=18, nicht gegen 3min*25ct", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, 100);
  makeDueOutboundCall(state, { nowMs, estimatedCostCents: 18 });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES, voiceTariffDomesticCents: 25 });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: voiceControl(control(recordsWithTotal(FULL_RECORD_TYPES, 16_000_000))),
    audit: () => {}, now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, 98, "Korrektur -2 (16-18), NICHT -59");
});

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

test("(l) estimatedCostCents=null (Bestandszeile), Records vollstaendig -> costTruedSource='no_estimate', Bilanz gemessen=0/ohne_schaetzung=1, keine Buchung", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, 100);
  const call = makeDueOutboundCall(state, { nowMs });
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

test("(p) KV-M3: NO_ESTIMATE verlaesst den Nenner, INCOMPLETE bleibt drin - die Quote ist NICHT mehr identisch", () => {
  const nowMs = Date.now();
  const withNoEstimate = makeDefaultState();
  const proven = makeDueOutboundCall(withNoEstimate, { nowMs, estimatedCostCents: 20 });
  proven.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  makeDueOutboundCall(withNoEstimate, { nowMs, legId: "cc_2" }).costTruedSource = COST_TRUING_SOURCE.NO_ESTIMATE;

  const withIncomplete = makeDefaultState();
  const proven2 = makeDueOutboundCall(withIncomplete, { nowMs, estimatedCostCents: 20 });
  proven2.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  makeDueOutboundCall(withIncomplete, { nowMs, legId: "cc_2", estimatedCostCents: 15 }).costTruedSource =
    COST_TRUING_SOURCE.INCOMPLETE;

  assert.equal(costTruingCoveragePercent(withNoEstimate), 100, "NO_ESTIMATE-Call verlaesst den Nenner - 1 von 1");
  assert.equal(costTruingCoveragePercent(withIncomplete), 50, "INCOMPLETE-Call MIT Schaetzung bleibt im Nenner - 1 von 2");
  assert.notEqual(
    costTruingCoveragePercent(withNoEstimate),
    costTruingCoveragePercent(withIncomplete),
    "genau der Unterschied, den KV-M3 herstellt: NO_ESTIMATE ist strukturell unbelegbar, INCOMPLETE ist ein echter Belegausfall",
  );
});

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

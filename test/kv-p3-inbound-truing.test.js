// KV-P3 (tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md): die Pflicht-Abnahmen der Phase - der
// Ist-Abgleich erreicht beendete INBOUND-Calls. Vorher lag ueber isTruingCandidate ein
// Richtungsfilter; KV-P2 buchte die Schaetzung (6 ct/min), niemand korrigierte sie.
// Die Fixturen tragen die an KV-M1 GEMESSENEN Zahlen (3.731.030 USD-Mikro-Cent fuer 2
// angefangene Minuten), damit die Erwartungen keine erfundenen Betraege sind.
//
// Muster test/cost-truing-booking.test.js: in-process, netzfrei, kein Server-Spawn, der
// Stub-Store delegiert an die ECHTEN state-ops-Funktionen. Kurs NEUTRAL (1_000_000, der
// fakeConfig-Default) - haelt die Cent-Fixturen direkt lesbar.
//
// control()/voiceControl()/recordsWithTotal() bleiben BEWUSST lokal, wie im Vorbild
// (cost-truing-booking.test.js) begruendet: eine Vereinheitlichung waere ein
// Verhaltensrisiko in einem Geld-Test ohne Nutzen fuer diese Datei.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCostTruing, SWEEP_TRIGGER, costTruingCoveragePercent } from "../src/billing/cost-truing.js";
import { makeDefaultState, usageFor } from "../src/store/state-ops.js";
import { COST_TRUING_SOURCE, BOOTSTRAP_TENANT_ID, emptyUsage } from "../src/store/defaults.js";
import { makeStubStore, fakeConfig, makeDueInboundCall, makeDueOutboundCall } from "./cost-truing-harness.js";

const FULL_RECORD_TYPES = ["sip-trunking", "call-control", "speech-to-text", "text-to-speech", "recording"];
// KV-M1, Ankeranruf call_msczw0irl06s: 13 Belege, 3.731.030 USD-Mikro-Cent, 79,6 s.
const KV_M1_ACTUAL_MICRO_CENTS = 3_731_030;
// KV-P2-Schaetzung desselben Anrufs: 2 angefangene Minuten x VOICE_TARIFF_INBOUND_CENTS (6).
const KV_M1_ESTIMATE_CENTS = 12;
// Kurs neutral (fakeConfig) -> Bucket-Cent = floor(3.731.030 * 1e6 / 1e12) = 3.
const KV_M1_BUCKET_CENTS = 3;
const ERWARTETES_DELTA_CENTS = KV_M1_BUCKET_CENTS - KV_M1_ESTIMATE_CENTS; // -9
const SEED_COST_CENTS = 100;

// Records mit GENAU EINEM nicht-leeren Betrag (auf dem ersten Typ), Rest 0 - Summe ist
// damit exakt totalMicroCents, unabhaengig von der Typ-Anzahl (Muster cost-truing-booking.test.js).
function recordsWithTotal(types, totalMicroCents, { billedSec = 120 } = {}) {
  return types.map((t, i) => ({
    recordType: t,
    costMicroCents: i === 0 ? totalMicroCents : 0,
    currency: "USD",
    billedSec,
  }));
}

// KV-P3: anders als das outbound-only Vorbild braucht dieser Kontrollstub eine Zuordnung
// PRO CALL (legId -> Records), weil KV-P3-4 Inbound und Outbound im selben Sweep gegen
// denselben Pool, aber unterschiedliche Belege faehrt.
function control(recordsByLegId) {
  return {
    async fetchCostRecordPool() {
      return { ok: true, raw: [], complete: true };
    },
    assignCostRecords(pool, { legId }) {
      return { ok: true, records: recordsByLegId[legId] ?? [] };
    },
  };
}

function voiceControl(impl) {
  return () => impl;
}

function seedUsageCents(state, tenantId, costCents) {
  state.usage[tenantId] = { ...emptyUsage(), costCents };
}

test("KV-P3-1 beendeter Inbound-Call mit vollstaendigen Belegen: cost_trued_at, actual_cost_micro_cents und eine Delta-Buchung auf der Gate-Achse", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, SEED_COST_CENTS);
  const call = makeDueInboundCall(state, {
    nowMs,
    estimatedCostCents: KV_M1_ESTIMATE_CENTS,
    legRef: { callControlId: "cc_kvp3_1" },
  });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const { runCostTruingSweep } = makeCostTruing({
    store, config,
    voiceControl: voiceControl(control({ cc_kvp3_1: recordsWithTotal(FULL_RECORD_TYPES, KV_M1_ACTUAL_MICRO_CENTS) })),
    audit: () => {}, now: () => nowMs,
  });

  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  // DIE Mutationsprobe in Assertion-Form: der Richtungsfilter wieder eingesetzt liesse
  // den EINZIGEN Call des Stores aus der Kandidatenmenge fallen -> 0 statt 1.
  assert.equal(result.candidates, 1, "ein beendeter Inbound-Call IST Kandidat");
  assert.equal(result.measured, 1);
  assert.notEqual(call.costTruedAt, null, "der Riegel ist gesetzt");
  assert.equal(call.actualCostMicroCents, KV_M1_ACTUAL_MICRO_CENTS, "USD-Mikro-Cent, UNVERAENDERT (D5)");
  // KV2-8: neu gesettelte Anrufe tragen 'kostenbuch_vollbeleg'.
  assert.equal(call.costTruedSource, COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG);
  assert.equal(
    usageFor(state, BOOTSTRAP_TENANT_ID).costCents,
    SEED_COST_CENTS + ERWARTETES_DELTA_CENTS,
    "die Gate-Achse traegt die Korrektur (12 ct Schaetzung -> 3 ct Ist = -9 ct)",
  );
});

test("KV-P3-2 zweiter Sweep ueber denselben Inbound-Call: kandidaten=0, keine zweite Buchung (costTruedAt riegelt)", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, SEED_COST_CENTS);
  makeDueInboundCall(state, {
    nowMs,
    estimatedCostCents: KV_M1_ESTIMATE_CENTS,
    legRef: { callControlId: "cc_kvp3_2" },
  });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const { runCostTruingSweep } = makeCostTruing({
    store, config,
    voiceControl: voiceControl(control({ cc_kvp3_2: recordsWithTotal(FULL_RECORD_TYPES, KV_M1_ACTUAL_MICRO_CENTS) })),
    audit: () => {}, now: () => nowMs,
  });

  const erster = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(erster.candidates, 1, "Vorbedingung: der erste Sweep sieht den Call als Kandidaten");
  const nachErstem = usageFor(state, BOOTSTRAP_TENANT_ID).costCents;
  const restNachErstem = state.usage[BOOTSTRAP_TENANT_ID].costCorrectionMicroCentsRem;
  const schreibzugriffeNachErstem = store.writes.length;

  const zweiter = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(zweiter.candidates, 0, "costTruedAt !== null nimmt den Call aus der Kandidatenmenge");
  assert.equal(zweiter.measured, 0);
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, nachErstem, "KEINE zweite Belastung/Gutschrift");
  assert.equal(store.writes.length, schreibzugriffeNachErstem, "kein zweiter Schreibzugriff am Call");
  assert.equal(
    state.usage[BOOTSTRAP_TENANT_ID].costCorrectionMicroCentsRem,
    restNachErstem,
    "der Mikro-Cent-Rest bleibt BIT-GLEICH",
  );
});

test("KV-P3-3 Inbound-Altzeile ohne estimatedCostCents: costTruedSource='no_estimate', keine Korrektur, kein Wurf", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, SEED_COST_CENTS);
  // estimatedCostCents bleibt null (exakt der Zustand der historischen Inbound-Calls vor KV-P2).
  const call = makeDueInboundCall(state, { nowMs, legRef: { callControlId: "cc_kvp3_3" } });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const { runCostTruingSweep } = makeCostTruing({
    store, config,
    voiceControl: voiceControl(control({ cc_kvp3_3: recordsWithTotal(FULL_RECORD_TYPES, KV_M1_ACTUAL_MICRO_CENTS) })),
    audit: () => {}, now: () => nowMs,
  });

  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(
    call.costTruedSource,
    COST_TRUING_SOURCE.NO_ESTIMATE,
    "vollstaendige Belege OHNE Schaetzbetrag -> eigener Zustand, nie 'incomplete'/'telnyx_detail_records'",
  );
  assert.equal(result.noEstimate, 1);
  assert.equal(result.measured, 0);
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, SEED_COST_CENTS, "kein Schaetzbetrag -> KEINE Korrektur");
  assert.equal(state.usage[BOOTSTRAP_TENANT_ID].costCorrectionMicroCentsRem, 0, "der Rest bleibt unberuehrt");
  assert.notEqual(call.costTruedAt, null, "Belege lagen vor -> abgeschlossen, kein weiterer Versuch");
});

test("KV-P3-4 Inbound und Outbound im SELBEN Sweep: jeder Call gegen seine EIGENE Schaetzung, keine Quervermischung der Belege", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedUsageCents(state, BOOTSTRAP_TENANT_ID, SEED_COST_CENTS);
  const IN_ESTIMATE_CENTS = 12;
  const OUT_ESTIMATE_CENTS = 20;
  const IN_MICRO_CENTS = KV_M1_ACTUAL_MICRO_CENTS; // 3 ct Ist
  const OUT_MICRO_CENTS = 18_000_000; // 18 ct Ist - bewusst ANDERS als Inbound
  const inbound = makeDueInboundCall(state, {
    nowMs, estimatedCostCents: IN_ESTIMATE_CENTS, legRef: { callControlId: "cc_kvp3_4_in" },
  });
  const outbound = makeDueOutboundCall(state, {
    nowMs, estimatedCostCents: OUT_ESTIMATE_CENTS, legRef: { callControlId: "cc_kvp3_4_out" },
  });
  const store = makeStubStore(state, { nowMs });
  const config = fakeConfig({ costTruingRequiredRecordTypes: FULL_RECORD_TYPES });
  const { runCostTruingSweep } = makeCostTruing({
    store, config,
    voiceControl: voiceControl(control({
      cc_kvp3_4_in: recordsWithTotal(FULL_RECORD_TYPES, IN_MICRO_CENTS),
      cc_kvp3_4_out: recordsWithTotal(FULL_RECORD_TYPES, OUT_MICRO_CENTS),
    })),
    audit: () => {}, now: () => nowMs,
  });

  const result = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(result.candidates, 2);
  assert.equal(result.measured, 2);
  assert.equal(inbound.actualCostMicroCents, IN_MICRO_CENTS, "der Inbound-Call bekommt NUR seine eigenen Belege");
  assert.equal(outbound.actualCostMicroCents, OUT_MICRO_CENTS, "der Outbound-Call bekommt NUR seine eigenen Belege");
  const IN_DELTA = KV_M1_BUCKET_CENTS - IN_ESTIMATE_CENTS; // -9
  const OUT_DELTA = 18 - OUT_ESTIMATE_CENTS; // -2
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).costCents, SEED_COST_CENTS + IN_DELTA + OUT_DELTA);
});

// Pinnt die Richtung als Absicht (Pre-Mortem TOD-E): KV-M3 aendert die FORMEL gegen diese
// Zusage, nicht gegen einen unbeobachteten Nebeneffekt dieser Phase.
// KV-M3: alle Fixtur-Calls brauchen zusaetzlich eine buchbare Schaetzung, sonst waeren sie
// unabhaengig vom Beweis-Status 'ohne_schaetzung' und faelen aus dem (jetzt engeren) Nenner.
test("KV-P3-5 Deckungsquote: ein bewiesener Inbound-Call hebt sie, ein unbewiesener senkt sie - die FORMEL bleibt unveraendert (KV-M3)", () => {
  const nowMs = Date.now();
  const state = makeDefaultState();

  // Basis: 1 bewiesener Outbound-Call -> 100 %.
  const provenOutbound = makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20, legRef: { callControlId: "cc_kvp3_5_out" } });
  provenOutbound.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  provenOutbound.costTruedAt = new Date(nowMs).toISOString();
  assert.equal(costTruingCoveragePercent(state), 100, "Basis: 1 von 1 bewiesen");

  // + 1 bewiesener beendeter Inbound-Call -> 100 % (Zaehler UND Nenner +1).
  const provenInbound = makeDueInboundCall(state, { nowMs, estimatedCostCents: 12, legRef: { callControlId: "cc_kvp3_5_in" } });
  provenInbound.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  provenInbound.costTruedAt = new Date(nowMs).toISOString();
  assert.equal(costTruingCoveragePercent(state), 100, "2 von 2 bewiesen");

  // + 1 unbewiesener beendeter Inbound-Call -> floor(2*100/3) = 66 %.
  const unprovenInbound = makeDueInboundCall(state, { nowMs, estimatedCostCents: 12, legRef: { callControlId: "cc_kvp3_5_in2" } });
  unprovenInbound.costTruedSource = COST_TRUING_SOURCE.UNAVAILABLE;
  unprovenInbound.costTruedAt = new Date(nowMs).toISOString();
  assert.equal(costTruingCoveragePercent(state), 66, "2 von 3 bewiesen");

  // Ein noch LAUFENDER Inbound-Call (endedAt === null) zaehlt in KEINER der beiden Achsen.
  const running = makeDueInboundCall(state, { nowMs, legRef: { callControlId: "cc_kvp3_5_running" } });
  running.endedAt = null;
  assert.equal(costTruingCoveragePercent(state), 66, "ein laufender Call veraendert die Quote nicht");
});

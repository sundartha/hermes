import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-secret-do-not-leak";
process.env.PROVIDER_CURRENCY = "USD";

const { telnyxVoice, ASSIGNABLE_COST_RECORD_TYPES } = await import("../src/telephony/adapters/telnyx/voice.js");
const { makeCostTruing, SWEEP_TRIGGER } = await import("../src/billing/cost-truing.js");
const { makeDefaultState, usageFor } = await import("../src/store/state-ops.js");
const { COST_TRUING_SOURCE, BOOTSTRAP_TENANT_ID, emptyUsage } = await import("../src/store/defaults.js");
const {
  makeStubStore, fakeConfig, makeDueOutboundCall, fakeVoiceControl, stubCountingFetch,
  foreignSipTrunkingPage, NEVER_LAST_PAGE_TOTAL,
} = await import("./cost-truing-harness.js");

const NO_PROOF_PROVIDER = "twilio";

const CANDIDATE_COUNT = 5;

function fakePoolAdapter({ recordsFor, complete = true, ok = true, trace = [], seenPools = [] } = {}) {
  return {
    async fetchCostRecordPool() {
      trace.push("pool");
      return ok ? { ok: true, raw: [], complete } : { ok: false, reason: "provider_error" };
    },
    assignCostRecords(pool, { legId }) {
      trace.push("assign");
      seenPools.push(pool);
      return { ok: true, records: recordsFor(legId) };
    },
  };
}

test("(P2-1) Sweep holt die Belege EINMAL je Sweep, nicht je Kandidat", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  for (let i = 0; i < CANDIDATE_COUNT; i++)
    makeDueOutboundCall(state, { nowMs, legRef: { callControlId: `cc_pool_${i}` } });
  const store = makeStubStore(state);
  const fetchCalls = stubCountingFetch();
  const config = fakeConfig();
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: fakeVoiceControl({ telnyx: telnyxVoice }), audit: () => {}, now: () => nowMs,
  });

  const res = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(fetchCalls.length, ASSIGNABLE_COST_RECORD_TYPES.length, "EIN Abruf je Typ, unabhaengig von der Kandidatenzahl");
  assert.equal(res.candidates, CANDIDATE_COUNT, "kein Kandidat ging beim Zaehlen verloren");
  assert.equal(store.writes.length, CANDIDATE_COUNT, "jeder Kandidat bekommt genau einen Schreibzugriff");
});

test("(P2-2) EIN Pool fuer alle Kandidaten, je Call der eigene Anker (keine Quervermischung)", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const legA = "cc_pool_a";
  const legB = "cc_pool_b";
  const callA = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: legA } });
  const callB = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: legB } });
  const store = makeStubStore(state);
  const seenPools = [];
  const recordsFor = (legId) => [
    { recordType: "sip-trunking", costMicroCents: legId === legA ? 1_000 : 2_000, currency: "USD", billedSec: 60, legId },
  ];
  const control = fakePoolAdapter({ recordsFor, seenPools });
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
  });

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(seenPools.length, 2, "beide Calls durchlaufen die Zuordnung");
  assert.equal(seenPools[0], seenPools[1], "derselbe Pool-Objektverweis fuer beide Calls (geteilter Pool)");
  assert.equal(callA.actualCostMicroCents, 1_000);
  assert.equal(callB.actualCostMicroCents, 2_000);
  assert.notEqual(callA.actualCostMicroCents, callB.actualCostMicroCents, "keine Quervermischung");
});

test("(P2-4) unvollstaendiger Pool (complete:false) -> alles unavailable; Gegenprobe complete:true misst und bucht", async () => {
  const nowMs = Date.now();
  const recordsFor = (legId) => [
    { recordType: "sip-trunking", costMicroCents: 5_000_000, currency: "USD", billedSec: 60, legId },
  ];
  const requiredTypes = ["sip-trunking"];

  const stateIncomplete = makeDefaultState();
  const callIncomplete = makeDueOutboundCall(stateIncomplete, {
    nowMs, legRef: { callControlId: "cc_incomplete" }, estimatedCostCents: 20,
  });
  const traceIncomplete = [];
  const { runCostTruingSweep: sweepIncomplete } = makeCostTruing({
    store: makeStubStore(stateIncomplete),
    config: fakeConfig({ costTruingRequiredRecordTypes: requiredTypes }),
    voiceControl: fakeVoiceControl({ telnyx: fakePoolAdapter({ recordsFor, complete: false, trace: traceIncomplete }) }),
    audit: () => {}, now: () => nowMs,
  });
  await sweepIncomplete({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(callIncomplete.costTruedSource, COST_TRUING_SOURCE.UNAVAILABLE);
  assert.equal(callIncomplete.actualCostMicroCents, null);
  assert.deepEqual(traceIncomplete, ["pool"], "assignCostRecords wird bei complete:false nie erreicht");

  const stateComplete = makeDefaultState();
  stateComplete.usage[BOOTSTRAP_TENANT_ID] = { ...emptyUsage(), costCents: 100 };
  makeDueOutboundCall(stateComplete, { nowMs, legRef: { callControlId: "cc_complete" }, estimatedCostCents: 20 });
  const traceComplete = [];
  const { runCostTruingSweep: sweepComplete } = makeCostTruing({
    store: makeStubStore(stateComplete),
    config: fakeConfig({ costTruingRequiredRecordTypes: requiredTypes }),
    voiceControl: fakeVoiceControl({ telnyx: fakePoolAdapter({ recordsFor, complete: true, trace: traceComplete }) }),
    audit: () => {}, now: () => nowMs,
  });
  await sweepComplete({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.deepEqual(traceComplete, ["pool", "assign"], "complete:true erreicht die Zuordnung");
  assert.equal(usageFor(stateComplete, BOOTSTRAP_TENANT_ID).costCents, 85, "Korrektur gebucht: 100 - 15 (Ist 5ct < Schaetzung 20ct)");
});

test("(P2-5) alle Pool-Abrufe liegen VOR der ersten Zuordnung (PM-5)", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  for (let i = 0; i < 3; i++) makeDueOutboundCall(state, { nowMs, legRef: { callControlId: `cc_trace_${i}` } });
  const trace = [];
  const control = fakePoolAdapter({ recordsFor: () => [], trace });
  const { runCostTruingSweep } = makeCostTruing({
    store: makeStubStore(state), config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: control }),
    audit: () => {}, now: () => nowMs,
  });

  const res = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(res.candidates, 3);
  assert.deepEqual(trace, ["pool", "assign", "assign", "assign"]);
});

test("(P2-6) je Provider genau EIN Pool-Abruf; Adapter ohne die Methoden bleibt No-op", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  makeDueOutboundCall(state, { nowMs, provider: "telnyx", legRef: { callControlId: "cc_t1" } });
  makeDueOutboundCall(state, { nowMs, provider: "telnyx", legRef: { callControlId: "cc_t2" } });
  const noProofA = makeDueOutboundCall(state, { nowMs, provider: NO_PROOF_PROVIDER, legRef: { twilioSid: "CA_t1" } });
  const noProofB = makeDueOutboundCall(state, { nowMs, provider: NO_PROOF_PROVIDER, legRef: { twilioSid: "CA_t2" } });
  const store = makeStubStore(state);
  const trace = [];
  const telnyxControl = fakePoolAdapter({ recordsFor: () => [], trace });
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: telnyxControl, [NO_PROOF_PROVIDER]: {} }),
    audit: () => {}, now: () => nowMs,
  });

  const res = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(trace.filter((t) => t === "pool").length, 1, "genau EIN Pool-Abruf fuer den einzigen Telnyx-Provider im Sweep");
  assert.equal(res.skippedCalls, 2, "beide Kandidaten ohne Beleg-Methoden bleiben No-op");
  for (const call of [noProofA, noProofB]) {
    assert.equal(call.costTruingAttempts, 0);
    assert.equal(call.costTruedSource, null);
  }
  assert.equal(
    store.writes.some((w) => w.callId === noProofA.id || w.callId === noProofB.id),
    false,
    "Twilio-Kandidaten bekommen keinen Schreibzugriff",
  );
});

test("(P2-3) ok:false-Pool -> ALLE Kandidaten unavailable, keine Buchung", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const calls = [0, 1, 2].map((i) => makeDueOutboundCall(state, { nowMs, legRef: { callControlId: `cc_fail_${i}` } }));
  const store = makeStubStore(state);
  const fetchCalls = stubCountingFetch({ status: 500, ok: false, bodyFor: () => ({}) });
  const usageBefore = structuredClone(state.usage);
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: telnyxVoice }), audit: () => {}, now: () => nowMs,
  });

  const res = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(fetchCalls.length, 1, "der erste scheiternde Typ bricht ab - kein Retry je Kandidat");
  assert.equal(res.unavailable, 3);
  assert.equal(res.measured, 0);
  for (const call of calls) {
    assert.equal(call.costTruedSource, COST_TRUING_SOURCE.UNAVAILABLE);
    assert.equal(call.actualCostMicroCents, null);
    assert.equal(call.costTruedAt, null);
    assert.equal(call.costTruingAttempts, 1);
  }
  assert.deepStrictEqual(structuredClone(state.usage), usageBefore, "keine Korrektur ohne Messung");
});

test("(P3-3) Seitenobergrenze -> KEINE Rueckerstattung: alle Kandidaten unavailable, kein Cent bewegt", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  state.usage[BOOTSTRAP_TENANT_ID] = { ...emptyUsage(), costCents: 100 };
  const calls = [0, 1, 2].map((i) =>
    makeDueOutboundCall(state, { nowMs, legRef: { callControlId: `cc_p3_3_cand_${i}` }, estimatedCostCents: 20 }),
  );
  const store = makeStubStore(state);
  const usageBefore = structuredClone(state.usage);
  const fetchCalls = stubCountingFetch({
    bodyFor: () => foreignSipTrunkingPage({
      at: new Date(nowMs).toISOString(), idPrefix: "cc_p3_3", totalPages: NEVER_LAST_PAGE_TOTAL,
    }),
  });
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: telnyxVoice }), audit: () => {}, now: () => nowMs,
  });

  const res = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(res.unavailable, 3);
  assert.equal(res.measured, 0);
  for (const call of calls) {
    assert.equal(call.costTruedSource, COST_TRUING_SOURCE.UNAVAILABLE);
    assert.equal(call.actualCostMicroCents, null);
    assert.equal(call.costTruingAttempts, 1);
  }
  assert.deepStrictEqual(structuredClone(state.usage), usageBefore, "keine Korrektur, insbesondere keine Rueckerstattung");
  assert.ok(fetchCalls.length < NEVER_LAST_PAGE_TOTAL, "die Seitenobergrenze beendet die Schleife, statt das Kontingent zu sprengen");
});

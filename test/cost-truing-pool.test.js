// KE-P2 (D1: den Abruf aus der Kandidatenschleife ziehen): Sweep-Ebene.
// Warum eine EIGENE Datei und nicht cost-truing-observe.test.js: die Kernzusage ist eine
// Aussage ueber ECHTE HTTP-Anfragen (35 -> 6, ab KE-P3: inference wird nicht mehr abgerufen).
// Sie ist nur mit dem ECHTEN Telnyx-Adapter
// beweisbar - ein Fake-Adapter koennte sie nicht falsifizieren. Der echte Adapter liest
// config.telephony.telnyxApiKey/-Base und config.billing.providerCurrency, deshalb
// process.env VOR den (dynamischen) Importen, Muster telnyx-cost-records.test.js
// (Lehre test-base-env-drift). Netzfrei: global.fetch ist gestubbt.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-secret-do-not-leak";
process.env.PROVIDER_CURRENCY = "USD";

const { telnyxVoice, ASSIGNABLE_COST_RECORD_TYPES } = await import("../src/telephony/adapters/telnyx/voice.js");
const { makeCostTruing, SWEEP_TRIGGER } = await import("../src/billing/cost-truing.js");
const { makeDefaultState, usageFor } = await import("../src/store/state-ops.js");
const { COST_TRUING_SOURCE, BOOTSTRAP_TENANT_ID, emptyUsage } = await import("../src/store/defaults.js");
const { makeStubStore, fakeConfig, makeDueOutboundCall, fakeVoiceControl } = await import(
  "./cost-truing-harness.js"
);

// Kandidatenzahl der D1-Kernzusage: gross genug, um "einmal je Typ" von "einmal je
// Kandidat" scharf zu unterscheiden (6 vs. 35), klein genug, um lesbar zu bleiben.
const CANDIDATE_COUNT = 5;

// Zaehlender fetch-Stub: eine LEERE, gemessene Listen-Seite je Typ ({data:[]} -> ok, kurze
// Seite, keine Truncation). Die Zuordnung ist hier NICHT der Pruefgegenstand, nur die
// ANZAHL der Anfragen bzw. (P2-3) der Abbruch beim ersten scheiternden Typ.
function stubCountingFetch({ status = 200, ok = true, body = { data: [] } } = {}) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return calls;
}

// Fake-Adapter im NEUEN Port-Zuschnitt. recordsFor(legId) spielt genau die Rolle, die
// frueher getVoiceCostRecords({legId}) hatte. trace zeichnet die Aufruf-Reihenfolge (PM-5:
// erst ALLE Pool-Abrufe, dann die Zuordnungen) auf, seenPools die POOL-IDENTITAET je
// Zuordnung (Objekt-Referenz, nicht Kopie) - der Beweis, dass alle Calls eines Providers
// denselben geteilten Pool sehen (P2-2).
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

// ---- P2-1: die Kernzusage, gemessen am ECHTEN Adapter (35 -> 6 HTTP-Anfragen, ab KE-P3) ----

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

// ---- P2-2: EIN Pool fuer alle Kandidaten, je Call der eigene Anker ----

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

// ---- P2-4: complete:false -> alles unavailable; Gegenprobe complete:true misst und bucht ----

test("(P2-4) unvollstaendiger Pool (complete:false) -> alles unavailable; Gegenprobe complete:true misst und bucht", async () => {
  const nowMs = Date.now();
  const recordsFor = (legId) => [
    { recordType: "sip-trunking", costMicroCents: 5_000_000, currency: "USD", billedSec: 60, legId },
  ];
  const requiredTypes = ["sip-trunking"];

  // Phase 1: complete:false. Der Fake WUERDE vollstaendige Records liefern, darf aber laut
  // bookablePool() nie zur Zuordnung kommen - der Riegel steht VOR assignCostRecords.
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

  // Phase 2 (Gegenprobe): derselbe Fake mit complete:true misst UND bucht.
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

// ---- P2-5: alle Pool-Abrufe liegen VOR der ersten Zuordnung (PM-5) ----

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

// ---- P2-6: je Provider genau EIN Pool-Abruf; Adapter ohne die Methoden bleibt No-op ----

test("(P2-6) je Provider genau EIN Pool-Abruf; Adapter ohne die Methoden bleibt No-op", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  makeDueOutboundCall(state, { nowMs, provider: "telnyx", legRef: { callControlId: "cc_t1" } });
  makeDueOutboundCall(state, { nowMs, provider: "telnyx", legRef: { callControlId: "cc_t2" } });
  const twilioA = makeDueOutboundCall(state, { nowMs, provider: "twilio", legRef: { twilioSid: "CA_t1" } });
  const twilioB = makeDueOutboundCall(state, { nowMs, provider: "twilio", legRef: { twilioSid: "CA_t2" } });
  const store = makeStubStore(state);
  const trace = [];
  const telnyxControl = fakePoolAdapter({ recordsFor: () => [], trace });
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: telnyxControl, twilio: {} }),
    audit: () => {}, now: () => nowMs,
  });

  const res = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(trace.filter((t) => t === "pool").length, 1, "genau EIN Pool-Abruf fuer den einzigen Telnyx-Provider im Sweep");
  assert.equal(res.skippedCalls, 2, "beide Twilio-Kandidaten bleiben No-op");
  for (const call of [twilioA, twilioB]) {
    assert.equal(call.costTruingAttempts, 0);
    assert.equal(call.costTruedSource, null);
  }
  assert.equal(
    store.writes.some((w) => w.callId === twilioA.id || w.callId === twilioB.id),
    false,
    "Twilio-Kandidaten bekommen keinen Schreibzugriff",
  );
});

// ---- P2-3: ok:false-Pool -> ALLE Kandidaten unavailable, keine Buchung ----

test("(P2-3) ok:false-Pool -> ALLE Kandidaten unavailable, keine Buchung", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const calls = [0, 1, 2].map((i) => makeDueOutboundCall(state, { nowMs, legRef: { callControlId: `cc_fail_${i}` } }));
  const store = makeStubStore(state);
  const fetchCalls = stubCountingFetch({ status: 500, ok: false, body: {} });
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

// ---- P3-3: Seitenobergrenze -> KEINE Rueckerstattung, kein Cent bewegt ----

// Volle, gemessene sip-trunking-Seite (Spec A1): call_control_id + telnyx_session_id sind die
// Zuordnungs-IDs, started_at das Zeitfeld, telnyx_leg_id der KOEDER (Feld, das der Code NICHT
// als Zuordnungsquelle nutzen darf - A2). meta.total_pages=99 laesst KEINE Seite als letzte
// gelten - das Ende der Seitenschleife kann hier nur die Seitenobergrenze bringen.
function measuredSipTrunkingPageBody() {
  const records = Array.from({ length: 50 }, (_, i) => ({
    record_type: "sip-trunking",
    cost: "0.0401",
    currency: "USD",
    call_control_id: `cc_p3_3_${i}`,
    telnyx_session_id: `sess_p3_3_${i}`,
    telnyx_leg_id: "0bad0bad-0bad-11f1-0bad-0bad0bad0bad0", // Koeder, s. A2
    started_at: "2026-07-20T10:01:00Z",
    billed_sec: 60,
  }));
  return { data: records, meta: { total_results: 50 * 99, total_pages: 99, page_size: 50 } };
}

test("(P3-3) Seitenobergrenze -> KEINE Rueckerstattung: alle Kandidaten unavailable, kein Cent bewegt", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  state.usage[BOOTSTRAP_TENANT_ID] = { ...emptyUsage(), costCents: 100 };
  const calls = [0, 1, 2].map((i) =>
    makeDueOutboundCall(state, { nowMs, legRef: { callControlId: `cc_p3_3_cand_${i}` }, estimatedCostCents: 20 }),
  );
  const store = makeStubStore(state);
  const usageBefore = structuredClone(state.usage);
  const fetchCalls = stubCountingFetch({ body: measuredSipTrunkingPageBody() });
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
  assert.ok(fetchCalls.length < 99, "die Seitenobergrenze beendet die Schleife, statt das Kontingent zu sprengen");
});

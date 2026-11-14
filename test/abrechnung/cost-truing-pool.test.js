import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-secret-do-not-leak";
process.env.PROVIDER_CURRENCY = "USD";

const { telnyxVoice, ASSIGNABLE_COST_RECORD_TYPES } = await import("../../src/telephony/adapters/telnyx/voice.js");
const { makeCostTruing, SWEEP_TRIGGER } = await import("../../src/billing/cost-truing.js");
const { makeDefaultState, usageFor } = await import("../../src/store/state-ops.js");
const { COST_TRUING_SOURCE } = await import("../../src/begriffe/abrechnung.js");
const { BOOTSTRAP_TENANT_ID } = await import("../../src/begriffe/mandant.js");
const { emptyUsage } = await import("../../src/store.js");
const {
  makeStubStore, fakeConfig, makeDueOutboundCall, fakeVoiceControl, stubCountingFetch,
  foreignSipTrunkingPage, NEVER_LAST_PAGE_TOTAL,
} = await import("../cost-truing-harness.js");

const NO_PROOF_PROVIDER = "altanbieter";

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

test("(h8a) letzter Versuch mit ok:false-Pool zaehlt als failed, nicht als unavailable; Sweep-Zeile nennt den unvollstaendigen Pool", async () => {
  const { captureConsole } = await import("../helpers.js");
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_h8a_last" } });
  call.costTruingAttempts = 4;
  const { runCostTruingSweep } = makeCostTruing({
    store: makeStubStore(state),
    config: fakeConfig(),
    voiceControl: fakeVoiceControl({ telnyx: fakePoolAdapter({ ok: false, recordsFor: () => [] }) }),
    audit: () => {}, now: () => nowMs,
  });
  let res;
  const lines = await captureConsole(async () => {
    res = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  });
  assert.equal(res.failed, 1);
  assert.equal(res.unavailable, 0);
  assert.equal(res.measured, 0);
  assert.match(lines.join("\n"), /anfragen=0 seiten=0 pool=0 vollstaendig=false/);
});

const { captureConsole } = await import("../helpers.js");

const H8A_COST_MICRO_CENTS = 100;

function h8aPoolAdapter({ records, pool = {} }) {
  return {
    async fetchCostRecordPool() {
      return { ok: true, raw: [], complete: true, ...pool };
    },
    assignCostRecords() {
      return { ok: true, records };
    },
  };
}

async function h8aSweep({ records, pool, estimatedCostCents = null, config = fakeConfig(), audit = () => {} }) {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = makeDueOutboundCall(state, { nowMs, estimatedCostCents, legRef: { callControlId: "cc_mut" } });
  const { runCostTruingSweep } = makeCostTruing({
    store: makeStubStore(state, { billing: config.billing }),
    config,
    voiceControl: fakeVoiceControl({ telnyx: h8aPoolAdapter({ records, pool }) }),
    audit,
    now: () => nowMs,
  });
  let res;
  const lines = await captureConsole(async () => {
    res = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  });
  return { res, lines, state, call };
}

const h8aRecord = (extra) => ({ recordType: "sip-trunking", costMicroCents: H8A_COST_MICRO_CENTS, ...extra });

const H8A_UNGUELTIGE_KOSTEN = [
  ["negativer Betrag neben gueltigem", [h8aRecord(), h8aRecord({ costMicroCents: -5 })]],
  ["leerer Eintrag neben gueltigem", [h8aRecord(), null]],
  ["Betrag als Text", [h8aRecord({ costMicroCents: "5" })]],
];

for (const [name, records] of H8A_UNGUELTIGE_KOSTEN) {
  test(`(h8a) Belegsumme: ${name} -> Messung unbestimmt, nicht gemessen`, async () => {
    const { res } = await h8aSweep({ records });
    assert.equal(res.measured, 0);
    assert.equal(res.unavailable, 1);
  });
}

const H8A_POOL_ZAEHLER = [
  ["gueltige Zaehler", { requests: 5, pages: 3 }, "anfragen=5 seiten=3 pool=0"],
  ["negative Seiten", { requests: 4, pages: -2 }, "anfragen=4 seiten=0 pool=0"],
  ["gebrochene Anfragen", { requests: 2.5, pages: 1 }, "anfragen=0 seiten=1 pool=0"],
  ["fehlende Zaehler", {}, "anfragen=0 seiten=0 pool=0"],
];

for (const [name, pool, erwartet] of H8A_POOL_ZAEHLER) {
  test(`(h8a) Sweep-Zeile: ${name} -> ${erwartet}`, async () => {
    const { lines } = await h8aSweep({ records: [h8aRecord()], pool });
    assert.ok(lines.some((line) => line.includes(erwartet)), lines.join("\n"));
  });
}

test("(h8a) Zeichen werden nur aus ganzen positiven Werten summiert", async () => {
  const { state } = await h8aSweep({
    records: [
      h8aRecord({ ttsCharacters: 40 }),
      h8aRecord({ ttsCharacters: -30 }),
      h8aRecord({ ttsCharacters: 2.5 }),
      h8aRecord({ ttsCharacters: 0 }),
      h8aRecord(),
    ],
  });
  assert.equal(usageFor(state, BOOTSTRAP_TENANT_ID).ttsCharacters, 40);
});

test("(h8a) Schwellenbefund nennt Zeichen, Kontingent und Zyklus", async () => {
  const { lines } = await h8aSweep({
    records: [h8aRecord({ ttsCharacters: 40 })],
    config: fakeConfig({ ttsCharacterQuota: 100, ttsCharacterQuotaWarnPercent: 30 }),
  });
  assert.ok(lines.some((line) => /grund=tts_quota_warn_threshold zeichen=40\/100 zyklus=\S+/.test(line)), lines.join("\n"));
});

test("(h8a) Kostenabweichung und Korrektur stehen mit Zahlen im Protokoll", async () => {
  const { lines } = await h8aSweep({ records: [h8aRecord({ costMicroCents: 1_000_000 })], estimatedCostCents: 10 });
  assert.ok(
    lines.some((line) => /\[cost-truing\] Kosten-Drift call=\S+ ist_usd_mikrocent=1000000 schaetzung_eur_cent=10 abweichung=90%/.test(line)),
    lines.join("\n"),
  );
  assert.ok(
    lines.some((line) => /\[cost-truing\] korrektur call=\S+ delta_eur_cent=-?\d+ gebucht=(true|false)/.test(line)),
    lines.join("\n"),
  );
});

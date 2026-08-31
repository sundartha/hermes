// KE-P9 (Belegabruf nur ueber abrufbare Kandidaten): EIGENE Datei (Muster cost-truing-since.test.js
// - eigener Gegenstand + node --test gibt je Datei ein eigenes Drossel-Budget). process.env VOR
// den dynamischen Importen (Lehre test-base-env-drift), netzfrei via stubCountingFetch.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-secret-do-not-leak";
process.env.PROVIDER_CURRENCY = "USD";

const { telnyxVoice } = await import("../src/telephony/adapters/telnyx/voice.js");
const { makeCostTruing, SWEEP_TRIGGER } = await import("../src/billing/cost-truing.js");
const { makeDefaultState } = await import("../src/store/state-ops.js");
const { captureConsole } = await import("./helpers.js");
const {
  makeStubStore, fakeConfig, makeDueOutboundCall, fakeVoiceControl, stubCountingFetch,
} = await import("./cost-truing-harness.js");

// FESTE Uhr (Muster P5_NOW): die erwartete Schranke in (P9-2) steht unten als LITERAL, nicht
// als zweite Ausfuehrung derselben Formel.
const P9_NOW = "2026-07-21T18:00:00.000Z";

const sweepLineOf = (lines) => lines.filter((l) => l.startsWith("[cost-truing] sweep "));

// Fake im Port-Zuschnitt, der die Pool-PARAMETER aufzeichnet (Muster cost-truing-since.test.js
// paramRecordingAdapter) - der Pruefgegenstand von (P9-2) ist der uebergebene since-Wert.
function paramRecordingAdapter(poolParams) {
  return {
    async fetchCostRecordPool(params) {
      poolParams.push(params);
      return { ok: true, raw: [], complete: true };
    },
    assignCostRecords: () => ({ ok: true, records: [] }),
  };
}

test("(P9-1) ausschliesslich nicht abrufbare Kandidaten -> 0 Anfragen, 0 Schreibzugriffe, 0 verbrauchte Versuche", async () => {
  const nowMs = Date.parse(P9_NOW);
  const state = makeDefaultState();
  const calls = [0, 1, 2].map(() => makeDueOutboundCall(state, { nowMs, legRef: {}, provider: "telnyx" }));
  const store = makeStubStore(state);
  const fetchCalls = stubCountingFetch();
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: telnyxVoice }), audit: () => {}, now: () => nowMs,
  });

  const res = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(fetchCalls.length, 0, "kein abrufbarer Kandidat -> keine einzige HTTP-Anfrage");
  assert.equal(store.writes.length, 0, "sauberes No-op: kein Schreibzugriff");
  assert.equal(res.candidates, 3);
  assert.equal(res.skippedCalls, 3);
  for (const call of calls) {
    assert.equal(call.costTruingAttempts, 0, "kein Versuch verbraucht");
    assert.equal(call.costTruedSource, null);
    assert.equal(call.costTruedAt, null);
  }
});

test("(P9-2) gemischt: ein alter nicht-abrufbarer + ein junger abrufbarer Call - die Schranke haengt am abrufbaren", async () => {
  const nowMs = Date.parse(P9_NOW);
  const state = makeDefaultState();
  makeDueOutboundCall(state, { nowMs, legRef: {}, endedMinutesAgo: 600 });
  const jung = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_p9_jung" }, endedMinutesAgo: 180 });
  const store = makeStubStore(state);
  const poolParams = [];
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: paramRecordingAdapter(poolParams) }),
    audit: () => {}, now: () => nowMs,
  });

  const res = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(poolParams.length, 1, "der Pool wird weiterhin geholt - der alte Call schliesst den Abruf nicht aus");
  // endedAt des jungen Calls = 15:00Z, minus die Marge. KS-P3: die Marge ist seit dieser
  // Phase aus MAX_CALL_DURATION_CAP_S abgeleitet (12 x 1800 s = 6 h statt vorher 1 h).
  assert.equal(poolParams[0]?.since, "2026-07-21T09:00:00.000Z", "die Schranke haengt am ABRUFBAREN Call, nicht am alten");
  assert.equal(res.skippedCalls, 1);
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0].callId, jung.id, "der junge Call ist nicht aus der Buchungsschleife gefallen");
});

test("(P9-3) leere abrufbare Menge bei nicht-leerer Kandidatenmenge -> Bilanz trotzdem korrekt geloggt (PM-4)", async () => {
  const nowMs = Date.parse(P9_NOW);
  const state = makeDefaultState();
  for (let i = 0; i < 3; i++) makeDueOutboundCall(state, { nowMs, legRef: {}, provider: "telnyx" });
  const store = makeStubStore(state);
  stubCountingFetch();
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: telnyxVoice }), audit: () => {}, now: () => nowMs,
  });

  const lines = await captureConsole(() => runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL }));
  const [line] = sweepLineOf(lines);

  assert.equal(
    line,
    "[cost-truing] sweep trigger=manual kandidaten=3 gemessen=0 unvollstaendig=0 " +
      "ohne_schaetzung=0 unbestimmt=0 uebersprungen=3 " +
      // KV2-1 (Kriterium (d)): kanaele= HINTER den Bestandsfeldern - kein Ziel gesetzt
      // (BASE_ENV/fakeConfig-Default) -> kanaele=keine. KV2-6: buch=/herzschlag=/
      // nie_beendet=/profillos= wachsen HINTER kanaele= - die 3 Kandidaten liegen
      // ausserhalb JEDES Fensters (makeDueOutboundCall-Default endedMinutesAgo=200min,
      // < der Karenz dieser Config) -> buch=keine herzschlag=keine.
      // KV2-7: erschoepft=/abschluesse= HINTER profillos=. Keine Antwort => keine der
      // drei Fixturen ist messbar (uebersprungen, keine Leg-Referenz) -> erschoepft=0
      // (der Zaehler zaehlt nur nicht mehr versuchbare, nicht uebersprungene Calls); sie
      // tragen kein costProfile UND schliessen in diesem Sweep nicht -> abschluesse=keine.
      // KV2-9: el_reifung=/el_abweichung=/el_uebrig= HINTER abschluesse= - kein
      // elKostenRead injiziert -> vollstaendiges No-op.
      "anfragen=0 seiten=0 pool=0 vollstaendig=true kanaele=keine buch=keine herzschlag=keine " +
      "nie_beendet=0 profillos=0 erschoepft=0 abschluesse=keine el_reifung=keine el_abweichung=0 el_uebrig=0",
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-secret-do-not-leak";
process.env.PROVIDER_CURRENCY = "USD";

const { telnyxVoice } = await import("../../src/telephony/adapters/telnyx/voice.js");
const { makeCostTruing, SWEEP_TRIGGER } = await import("../../src/billing/cost-truing.ts");
const { makeDefaultState } = await import("../../src/store/state-ops.js");
const { captureConsole } = await import("../helpers.js");
const { makeStubStore, fakeConfig, makeDueOutboundCall, fakeVoiceControl, stubCountingFetch } = await import("../cost-truing-harness.js");

test("(4709) Schreibfehler an einem Anruf bricht den Abgleichlauf nicht ab: failed=1, zweiter Anruf wird gezaehlt, Bericht und Log erscheinen", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const erster = makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_4709_a" } });
  makeDueOutboundCall(state, { nowMs, legRef: { callControlId: "cc_4709_b" } });
  const store = makeStubStore(state);
  const echt = store.recordCallCostTruingResult;
  store.recordCallCostTruingResult = (callId, outcome) => {
    if (callId === erster.id) throw new Error("db weg 4709");
    return echt(callId, outcome);
  };
  stubCountingFetch();
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: telnyxVoice }), audit: () => {}, now: () => nowMs,
  });

  let ergebnis;
  const lines = await captureConsole(async () => {
    ergebnis = await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  });
  assert.equal(ergebnis.skipped, false);
  assert.equal(ergebnis.failed, 1);
  assert.equal(ergebnis.unavailable, 1);
  assert.equal(store.writes.length, 1);
  assert.equal(ergebnis.candidates, 2);
  assert.ok(lines.some((l) => l.startsWith("[cost-truing] sweep ")), "Zaehlzeile erscheint trotz Fehler");
  assert.ok(lines.some((l) => l.includes(erster.id) && l.includes("db weg 4709")), "Fehler wird mit Anruf-Kennung geloggt");
});

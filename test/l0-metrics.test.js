import test from "node:test";
import assert from "node:assert/strict";
import { createMetrics } from "../src/metrics.js";

function collector() {
  const entries = [];
  return { log: (kind, payload) => entries.push({ kind, payload }), entries };
}

function fakeNow(values) {
  let i = 0;
  return () => values[i++];
}

test("T-L0-1: llmCall ist PII-frei (nur die vier Whitelist-Felder)", () => {
  const { log, entries } = collector();
  const m = createMetrics({ enabled: true, log });

  m.llmCall({ outcome: "success", attempts: 1, latencyMs: 5, breakerState: "closed", secret: "leak" });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "llm");
  assert.deepEqual(Object.keys(entries[0].payload).sort(), [
    "attempts",
    "breakerState",
    "latencyMs",
    "outcome",
  ]);
  assert.ok(!("secret" in entries[0].payload));
});

test("T-L0-1b (I13): llmCall traegt callId + Cache-Zaehler additiv, NUR wenn mitgegeben; fremde Felder bleiben draussen", () => {
  const { log, entries } = collector();
  const m = createMetrics({ enabled: true, log });

  m.llmCall({
    outcome: "success",
    attempts: 1,
    latencyMs: 5,
    breakerState: "closed",
    callId: "c1",
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 100,
    secret: "leak",
  });

  assert.equal(entries.length, 1);
  assert.deepEqual(Object.keys(entries[0].payload).sort(), [
    "attempts",
    "breakerState",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "callId",
    "latencyMs",
    "outcome",
  ]);
  assert.equal(entries[0].payload.callId, "c1");
  assert.equal(entries[0].payload.cache_creation_input_tokens, 20);
  assert.equal(entries[0].payload.cache_read_input_tokens, 100);
  assert.ok(!("secret" in entries[0].payload));
});

test("FIX1-4: llmCall traegt ALLE VIER Token-Sorten additiv (Whitelist erweitert, Bestandsform sonst unveraendert)", () => {
  const { log, entries } = collector();
  const m = createMetrics({ enabled: true, log });

  m.llmCall({
    outcome: "success",
    attempts: 1,
    latencyMs: 5,
    breakerState: "closed",
    callId: "c1",
    input_tokens: 5,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 100,
    output_tokens: 7,
  });

  assert.equal(entries.length, 1);
  assert.deepEqual(Object.keys(entries[0].payload).sort(), [
    "attempts",
    "breakerState",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "callId",
    "input_tokens",
    "latencyMs",
    "outcome",
    "output_tokens",
  ]);
  assert.equal(entries[0].payload.input_tokens, 5);
  assert.equal(entries[0].payload.cache_creation_input_tokens, 20);
  assert.equal(entries[0].payload.cache_read_input_tokens, 100);
  assert.equal(entries[0].payload.output_tokens, 7);
});

test("FIX1-5: kein Leck - Transkript/Prompt/Modelltext erreichen die llm-Metrik nie, nur Zahlen", () => {
  const { log, entries } = collector();
  const m = createMetrics({ enabled: true, log });

  m.llmCall({
    outcome: "success",
    attempts: 1,
    latencyMs: 5,
    breakerState: "closed",
    callId: "c1",
    input_tokens: 5,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 100,
    output_tokens: 7,
    transcript: "ich haette gern einen Termin",
    system: "Du bist Hermes",
    text: "Modelltext",
    messages: [{ role: "user", content: "geheim" }],
    apiKey: "sk-ant-geheim",
  });

  assert.equal(entries.length, 1);
  assert.deepEqual(Object.keys(entries[0].payload).sort(), [
    "attempts",
    "breakerState",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "callId",
    "input_tokens",
    "latencyMs",
    "outcome",
    "output_tokens",
  ]);
  const serialized = JSON.stringify(entries[0].payload);
  assert.ok(!serialized.includes("Termin"));
  assert.ok(!serialized.includes("Hermes"));
  assert.ok(!serialized.includes("sk-ant"));
  for (const field of ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"]) {
    assert.equal(typeof entries[0].payload[field], "number");
  }
});

test("T-L0-2: Master-Schalter aus -> keine der fuenf Funktionen loggt (byte-identisch)", () => {
  const { log, entries } = collector();
  const m = createMetrics({ enabled: false, log });

  m.llmCall({ outcome: "success", attempts: 1, latencyMs: 5, breakerState: "closed" });
  m.logTurn({ callId: "c1", direction: "inbound", roundtrips: 1, tools: [] });
  m.recordTurnRendered("c1");
  m.logTurnGap("c1");
  m.logSpeechResult({ callId: "c1", chars: 17 });

  assert.equal(entries.length, 0);
});

test("T-L0-3: logTurn ist PII-frei (Tool-NAMEN, kein Transkript)", () => {
  const { log, entries } = collector();
  const m = createMetrics({ enabled: true, log });

  m.logTurn({ callId: "c1", direction: "outbound", roundtrips: 2, tools: ["list_calls", "end_call"] });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "turn");
  assert.deepEqual(Object.keys(entries[0].payload).sort(), [
    "callId",
    "direction",
    "roundtrips",
    "tools",
  ]);
  assert.deepEqual(entries[0].payload.tools, ["list_calls", "end_call"]);
  assert.ok(entries[0].payload.tools.every((t) => typeof t === "string"));
});

test("T-L0-4: STT-Gap = JETZT - voriger Render; Erst-Turn ohne Vorgaenger loggt nicht", () => {
  const { log, entries } = collector();
  const m = createMetrics({ enabled: true, log, now: fakeNow([1000, 1700]) });

  m.logTurnGap("c1");
  assert.equal(entries.length, 0);

  m.recordTurnRendered("c1");
  m.logTurnGap("c1");

  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "stt_gap");
  assert.deepEqual(entries[0].payload, { callId: "c1", gapMs: 700 });
});


test("T-L0-7 (P2a): logSpeechResult ist PII-frei (nur callId + chars, NIE Text)", () => {
  const { log, entries } = collector();
  const m = createMetrics({ enabled: true, log });

  m.logSpeechResult({ callId: "c1", chars: 42, text: "ich haette gern einen Termin" });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "speech_result");
  assert.deepEqual(Object.keys(entries[0].payload).sort(), ["callId", "chars"]);
  assert.equal(entries[0].payload.chars, 42);
  assert.ok(!("text" in entries[0].payload));
  assert.equal(JSON.stringify(entries[0].payload).includes("Termin"), false, "Gehoertes NIE im Log");
});

test("T-L0-7b (P2a): chars=0 wird geloggt (No-Speech ist ein Signal, kein Nicht-Ereignis)", () => {
  const { log, entries } = collector();
  const m = createMetrics({ enabled: true, log });

  m.logSpeechResult({ callId: "c1", chars: 0 });

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].payload, { callId: "c1", chars: 0 });
});

test("T-L0-8 (E5-02, OUTBOUND-E5): logSenderFallback ist PII-frei (NUR grund - NIE Rufnummer/tenantId/callId)", () => {
  const { log, entries } = collector();
  const metrics = createMetrics({ enabled: true, log });

  metrics.logSenderFallback({
    grund: "keine_eigene_registrierung",
    to: "+491701234567",
    tenantId: "t_leak",
    callId: "c_leak",
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "sender_fallback");
  assert.deepEqual(Object.keys(entries[0].payload), ["grund"], "NUR der Grund-Code, kein weiteres Feld erreicht das Log");
  assert.equal(entries[0].payload.grund, "keine_eigene_registrierung");
  assert.equal(JSON.stringify(entries[0].payload).includes("+491701234567"), false, "Rufnummer NIE im Log");
  assert.equal(JSON.stringify(entries[0].payload).includes("t_leak"), false, "tenantId NIE im Log");
  assert.equal(JSON.stringify(entries[0].payload).includes("c_leak"), false, "callId NIE im Log");
});

test("T-L0-8b (E5-02): logSenderFallback schweigt bei enabled=false (Master-Schalter, Muster logCallDenied)", () => {
  const { log, entries } = collector();
  const metrics = createMetrics({ enabled: false, log });

  metrics.logSenderFallback({ grund: "keine_eigene_registrierung" });

  assert.equal(entries.length, 0);
});

test("T-L0-5: beschraenkte Map verdraengt den aeltesten Eintrag (Leak-Schutz)", () => {
  const { log, entries } = collector();
  const m = createMetrics({
    enabled: true,
    log,
    now: fakeNow([10, 20, 30, 40]),
    maxTrackedCalls: 2,
  });

  m.recordTurnRendered("A");
  m.recordTurnRendered("B");
  m.recordTurnRendered("C");

  m.logTurnGap("A");
  assert.equal(entries.length, 0);

  m.logTurnGap("C");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "stt_gap");
  assert.deepEqual(entries[0].payload, { callId: "C", gapMs: 10 });
});

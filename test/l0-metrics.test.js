// L0-Mess-Instrumentierung (src/metrics.js): reine Unit gegen injizierte Fakes -
// kein Server-Spawn, kein pglite, store-agnostisch (F.I.R.S.T.: schnell, offline,
// deterministisch). Prueft das NEUE Verhalten (PII-Whitelist, Master-Schalter,
// STT-Gap-Ableitung, beschraenkte Map). Die Verdrahtung in claude.js/server.js ist
// byte-identisch-wenn-aus (BASE_ENV pinnt METRICS_ENABLED=false) und wird ueber das
// Gruen-Bleiben der Bestandssuite abgedeckt.
import test from "node:test";
import assert from "node:assert/strict";
import { createMetrics } from "../src/metrics.js";

// Build-Helper (P13): Sammler liefert die (kind, payload)-Paare jedes log-Aufrufs.
function collector() {
  const entries = [];
  return { log: (kind, payload) => entries.push({ kind, payload }), entries };
}

// Build-Helper: now-Stub liefert die vorgegebenen Werte der Reihe nach (deterministische
// Zeit statt Date.now im Hot-Path-Test, F.I.R.S.T. R).
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

test("T-L0-2: Master-Schalter aus -> keine der vier Funktionen loggt (byte-identisch)", () => {
  const { log, entries } = collector();
  const m = createMetrics({ enabled: false, log });

  m.llmCall({ outcome: "success", attempts: 1, latencyMs: 5, breakerState: "closed" });
  m.logTurn({ callId: "c1", direction: "inbound", roundtrips: 1, tools: [] });
  m.recordTurnRendered("c1");
  m.logTurnGap("c1");

  assert.equal(entries.length, 0);
});

test("T-L0-3: logTurn ist PII-frei (Tool-NAMEN, kein Transkript)", () => {
  const { log, entries } = collector();
  const m = createMetrics({ enabled: true, log });

  m.logTurn({ callId: "c1", direction: "outbound", roundtrips: 2, tools: ["get_calendar", "end_call"] });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "turn");
  assert.deepEqual(Object.keys(entries[0].payload).sort(), [
    "callId",
    "direction",
    "roundtrips",
    "tools",
  ]);
  assert.deepEqual(entries[0].payload.tools, ["get_calendar", "end_call"]);
  assert.ok(entries[0].payload.tools.every((t) => typeof t === "string"));
});

test("T-L0-4: STT-Gap = JETZT - voriger Render; Erst-Turn ohne Vorgaenger loggt nicht", () => {
  const { log, entries } = collector();
  // record@1000, gap-Aufruf@1700 -> gapMs 700.
  const m = createMetrics({ enabled: true, log, now: fakeNow([1000, 1700]) });

  m.logTurnGap("c1"); // kein Vorgaenger -> kein Log
  assert.equal(entries.length, 0);

  m.recordTurnRendered("c1"); // now()=1000
  m.logTurnGap("c1"); // now()=1700

  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "stt_gap");
  assert.deepEqual(entries[0].payload, { callId: "c1", gapMs: 700 });
});

test("T-L0-5: beschraenkte Map verdraengt den aeltesten Eintrag (Leak-Schutz)", () => {
  const { log, entries } = collector();
  // maxTrackedCalls=2: nach A,B,C ist A verdraengt; now liefert record-Zeiten + Gap-Zeit.
  const m = createMetrics({
    enabled: true,
    log,
    now: fakeNow([10, 20, 30, 40]),
    maxTrackedCalls: 2,
  });

  m.recordTurnRendered("A"); // now()=10
  m.recordTurnRendered("B"); // now()=20
  m.recordTurnRendered("C"); // now()=30 -> A faellt raus

  m.logTurnGap("A"); // A verdraengt -> kein Log
  assert.equal(entries.length, 0);

  m.logTurnGap("C"); // now()=40 -> 40-30
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "stt_gap");
  assert.deepEqual(entries[0].payload, { callId: "C", gapMs: 10 });
});

// AL-P7b (src/thinking-signal.js): der Ueberbrueckungssatz eines Turns - reine Einheit,
// kein Store-/config-/IO-Zugriff, offline testbar (kein Netz, kein Server-Spawn, P12/R).
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang - Praefix ist "AL-P7b-<n>:".
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeThinkingSignal, THINKING_SIGNAL_MAX_CHARS } from "../src/thinking-signal.js";

// Build-Operate-Check (P13): ein Spy fuer onSpeechChunk, plus die gesammelten Fragmente.
function chunkSpy() {
  const chunks = [];
  const onSpeechChunk = (t) => chunks.push(t);
  return { onSpeechChunk, chunks };
}

test("AL-P7b-1: Flag aus ODER kein Abnehmer -> kein Aufruf, kein spoken()", () => {
  const { onSpeechChunk, chunks } = chunkSpy();
  const off = makeThinkingSignal({ onSpeechChunk, enabled: false });
  assert.equal(off.speakBridge("Einen Moment."), false);
  assert.deepEqual(chunks, []);
  assert.equal(off.spoken(), false);

  const noSink = makeThinkingSignal({ onSpeechChunk: undefined, enabled: true });
  assert.equal(noSink.speakBridge("Einen Moment."), false);
  assert.equal(noSink.spoken(), false);
});

test("AL-P7b-2: nur EINMAL pro Turn - der zweite Aufruf im selben Turn spricht nicht mehr", () => {
  const { onSpeechChunk, chunks } = chunkSpy();
  const signal = makeThinkingSignal({ onSpeechChunk, enabled: true });
  assert.equal(signal.speakBridge("Einen Moment, das pruefe ich."), true);
  assert.equal(signal.speakBridge("Noch ein Satz."), false, "Einmal-Riegel");
  assert.equal(chunks.length, 1);
  assert.equal(signal.spoken(), true);
});

test("AL-P7b-3: der gesprochene Text ist geshapt und traegt das Trennzeichen am Ende", () => {
  const { onSpeechChunk, chunks } = chunkSpy();
  const signal = makeThinkingSignal({ onSpeechChunk, enabled: true });
  signal.speakBridge("- Einen Moment");
  assert.equal(chunks.length, 1);
  const bridge = chunks[0];
  assert.ok(!bridge.includes("-"), "kein Listenmarker mehr");
  assert.ok(/[.!?] $/.test(bridge), "Satzende gesetzt, dann Leerzeichen als Trennzeichen");
});

test("AL-P7b-4: ueberlanger Text wird an einer Wortgrenze gekappt (kein Wortfragment)", () => {
  const { onSpeechChunk, chunks } = chunkSpy();
  const signal = makeThinkingSignal({ onSpeechChunk, enabled: true });
  const langerText = "Wort ".repeat(40).trim(); // deutlich ueber THINKING_SIGNAL_MAX_CHARS
  signal.speakBridge(langerText);
  const bridge = chunks[0].trimEnd();
  assert.ok(bridge.length <= THINKING_SIGNAL_MAX_CHARS + 1, "Kappe haelt (plus Satzendzeichen)");
  assert.ok(!bridge.endsWith("Wor"), "keine mitten im Wort abgeschnittene Kappe");
});

test("AL-P7b-5: leerer/Whitespace-/Nicht-String-Rundentext -> kein Aufruf des Abnehmers", () => {
  for (const empty of ["", "   ", null, undefined, 42]) {
    const { onSpeechChunk, chunks } = chunkSpy();
    const signal = makeThinkingSignal({ onSpeechChunk, enabled: true });
    assert.equal(signal.speakBridge(empty), false, `Eingabe: ${JSON.stringify(empty)}`);
    assert.deepEqual(chunks, []);
  }
});

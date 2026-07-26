// Akzeptanztests fuer afix-p3 (tasks/assistant-fix-spec.md P3, RCA R4): Farewell-Hangup im
// Conversation-Watchdog. Verdrahtet den ECHTEN Watchdog (makeConversationWatchdog) + das
// ECHTE Terminierungs-Primitiv (makeCallControlTerminator) gegen einen Fake-Store/-VoiceControl/
// -Timer (kein Netz/Spawn, injizierte Zeit, F.I.R.S.T.) - EINE Ebene tiefer als
// telnyx-shim-endcall.test.js (dort wird der Shim-Kontrakt geprueft, hier die Watchdog-Logik
// selbst: Suspendierung/Cancel/Clamp/Idempotenz). Erwartungswerte bewusst hart kodiert
// (Test-Orakel; ein Import der SUT-Konstanten wuerde einen falschen Wert mit-durchwinken).
//
// K3-Fix (MAJOR-1, PLAN-CONVERSATION-OPTIMIZATION.md): scheduleFarewellHangup nimmt seit dem
// Fix ein Optionsobjekt { speechChars, language } statt der blossen Zeichenzahl - die
// Kalibrierung ist sprachabhaengig (nur 'de' vermessen). F1-F9 sind German-Kalibrierungstests
// (language: "de") und pruefen damit weiterhin die NEUEN, gemessenen Konstanten. F10 ist der
// eigentliche Regressionsschutz gegen MAJOR-1: en/fr/undefined MUESSEN weiterhin die ALTEN,
// unveraenderten Fallback-Konstanten bekommen.
//
// 2. Review-Runde (MAJOR-1-Wiedervorlage): der 1. Fix hatte minMs faelschlich als EINEN
// globalen Wert (1500ms) angelegt statt ihn Teil der Kalibrierung sein zu lassen - damit war
// der Fallback-Sockel (der bisher 3000ms betrug) fuer 0-21 Zeichen KUERZER als das
// Bestandsverhalten (bei 8 Zeichen: 2060ms statt 3000ms), obwohl F10 behauptete, die alten
// Konstanten seien unveraendert. minMs lebt jetzt IN jedem Kalibrierungs-Eintrag (de: 1500,
// Fallback: 3000 = Bestand). F10/F11 unten sind entsprechend korrigiert, F12 ist der neue
// Pflicht-Regressionstest: der Fallback darf fuer KEINE Zeichenzahl kuerzer sein als die alte
// Formel clamp(1500 + 70*c, 3000, 12000).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fakeStore,
  makeCall,
  voiceControlSpy,
  fakeTimers,
  makeTestWatchdog,
  DEAD_AIR_TEST_MS,
} from "./telnyx-shim-harness.js";
import { captureConsole } from "./helpers.js";

// Voller Satz statt Kuerzel: robust gegen eine lokal geleakte CALLER_SUBSTANCE_MIN_LEN
// (isSubstantialCallerText liest den echten config.js-Singleton).
const SUBSTANTIAL_TEXT = "Ja, das passt mir gut, vielen Dank fuer den Rueckruf naechste Woche.";

function setup() {
  const call = makeCall();
  const store = fakeStore({ call });
  const voiceControl = voiceControlSpy();
  const timers = fakeTimers();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers });
  return { call, store, voiceControl, timers, watchdog };
}

test("F1: Delay laeuft ab -> genau EIN terminate mit korrekter callControlId", async () => {
  const { call, voiceControl, timers, watchdog } = setup();

  watchdog.arm(call.id);
  watchdog.scheduleFarewellHangup(call.id, { speechChars: 20, language: "de" });
  timers.fireAll();
  await Promise.resolve(); // terminate() ist async (Promise.resolve(terminate(...)).catch)

  assert.deepEqual(voiceControl.calls, [{ provider: "telnyx", callControlId: call.callControlId }]);
});

test("F2: Dead-Air ist waehrend des Delays suspendiert (Timer ersetzt, kein dead_air-Log)", async () => {
  const { call, timers, watchdog } = setup();

  watchdog.arm(call.id);
  assert.deepEqual(timers.pendingDelays(), [DEAD_AIR_TEST_MS], "Dead-Air-Timer initial gestellt");

  const { delayMs } = watchdog.scheduleFarewellHangup(call.id, { speechChars: 20, language: "de" });
  assert.deepEqual(timers.pendingDelays(), [delayMs], "Dead-Air-Timer durch Farewell-Timer ersetzt");

  const lines = await captureConsole(async () => {
    timers.fireAll();
    await Promise.resolve();
  });
  assert.ok(!lines.some((l) => l.includes("dead_air")), "kein irrefuehrendes dead_air-Log");
});

test("F3: observeTurn waehrend des Delays cancelt den Farewell (Dead-Air lebt wieder auf)", async () => {
  const { call, voiceControl, timers, watchdog } = setup();

  watchdog.arm(call.id);
  watchdog.scheduleFarewellHangup(call.id, { speechChars: 20, language: "de" });
  watchdog.observeTurn(call.id, SUBSTANTIAL_TEXT);

  assert.deepEqual(timers.pendingDelays(), [DEAD_AIR_TEST_MS], "Farewell weg, Dead-Air wieder scharf");

  watchdog.clear(call.id);
  timers.fireAll();
  assert.equal(voiceControl.calls.length, 0, "kein Hangup - der Abschied war verfrueht");
});

test("F4: clear waehrend des Delays (externer Hangup gewinnt) - kein zweites terminate", async () => {
  const { call, voiceControl, timers, watchdog } = setup();

  watchdog.arm(call.id);
  watchdog.scheduleFarewellHangup(call.id, { speechChars: 20, language: "de" });
  watchdog.clear(call.id);

  assert.equal(timers.pendingCount(), 0, "beide Timer geraeumt");
  timers.fireAll();
  assert.equal(voiceControl.calls.length, 0, "kein zweiter Hangup-Versuch auf einen bereits beendeten Call");
});

test("F5: Clamp Untergrenze (de) - 0 Zeichen -> der gemessene de-Sockel 1500ms", () => {
  const { call, watchdog } = setup();
  const { delayMs } = watchdog.scheduleFarewellHangup(call.id, { speechChars: 0, language: "de" });
  assert.equal(delayMs, 1500);
});

test("F6: Clamp Obergrenze - 1000 Zeichen -> FAREWELL_MAX_MS (sprachunabhaengig)", () => {
  const { call, watchdog } = setup();
  const { delayMs } = watchdog.scheduleFarewellHangup(call.id, { speechChars: 1000, language: "de" });
  assert.equal(delayMs, 15_000);
});

test("F7: Formel greift zwischen den Grenzen (de) - 100 Zeichen -> 500 + 100*65", () => {
  const { call, watchdog } = setup();
  const { delayMs } = watchdog.scheduleFarewellHangup(call.id, { speechChars: 100, language: "de" });
  assert.equal(delayMs, 7000);
});

test("F8: zweiter scheduleFarewellHangup fuer denselben Call ersetzt den Timer (nie zwei Terminierungen)", async () => {
  const { call, voiceControl, timers, watchdog } = setup();

  watchdog.scheduleFarewellHangup(call.id, { speechChars: 20, language: "de" });
  watchdog.scheduleFarewellHangup(call.id, { speechChars: 20, language: "de" });
  assert.equal(timers.pendingCount(), 1, "kein zweiter, paralleler Timer");

  timers.fireAll();
  await Promise.resolve();
  assert.equal(voiceControl.calls.length, 1, "genau ein Hangup");
});

// K3 (PLAN-CONVERSATION-OPTIMIZATION.md): der eigentliche Regressionsschutz gegen R4 fuer die
// DEUTSCHE Kalibrierung. Zwei realistische Abschiedssaetze (162 und 206 Zeichen, der laengste
// live gemessene Fall) mit ihrer REAL gemessenen Sprechdauer aus der Forensik (Kanaltrennung +
// silencedetect):
//  - 162 Zeichen -> 7.965s: tasks/afix-testcall-report.md, Agent-Kanal Turn 2 (Verabschiedung),
//    Hauptaeusserung 17.919s-25.884s (= 7.965s).
//  - 206 Zeichen -> 11.694s: tasks/afix-testcall2-report.md, Turn-3-Audiofenster (Abschied)
//    17:37:34.393-17:37:46.087 (= 11.694s).
// Die Kalibrierung ist bewusst asymmetrisch (langsamste, nicht mittlere gemessene Rate) -
// deshalb muss der geschaetzte Delay die reale Sprechdauer IMMER erreichen oder ueberschreiten,
// nie unterschreiten. Ein Reissen dieses Tests waere exakt R4 (der Abschiedssatz wird
// abgeschnitten).
test("F9: Asymmetrie-Regressionsschutz (de) - Delay unterschreitet NIE die real gemessene Sprechdauer", () => {
  const { call, watchdog } = setup();
  const REAL_SPEECH_MS_162_CHARS = 7965;
  const REAL_SPEECH_MS_206_CHARS = 11_694;

  const { delayMs: delay162 } = watchdog.scheduleFarewellHangup(call.id, {
    speechChars: 162,
    language: "de",
  });
  assert.ok(
    delay162 >= REAL_SPEECH_MS_162_CHARS,
    `162 Zeichen: Delay ${delay162}ms unterschreitet die gemessene Sprechdauer ${REAL_SPEECH_MS_162_CHARS}ms`,
  );

  const { delayMs: delay206 } = watchdog.scheduleFarewellHangup(call.id, {
    speechChars: 206,
    language: "de",
  });
  assert.ok(
    delay206 >= REAL_SPEECH_MS_206_CHARS,
    `206 Zeichen: Delay ${delay206}ms unterschreitet die gemessene Sprechdauer ${REAL_SPEECH_MS_206_CHARS}ms`,
  );
});

// F10 (MAJOR-1, der zentrale Regressionsschutz dieses Fixes): jede Sprache AUSSER 'de' - und
// eine fehlende Sprache - MUESSEN die ALTEN, unveraenderten Fallback-Konstanten bekommen
// (1500ms Basis + 70ms/Zeichen, minMs 3000ms = EXAKT das Bestandsverhalten vor K3). Waeren die
// de-Werte hier auch fuer en/fr aktiv, wuerde ein englischer/franzoesischer Abschiedssatz zu
// knapp geschaetzt -> abgeschnitten (R4). Formel-Beleg fuer 100 Zeichen: 1500 + 100*70 = 8500
// (!= 7000 wie in F7 fuer de).
// 2. Review-Runde (MAJOR-1-Wiedervorlage): minMs ist jetzt TEIL der Kalibrierung, nicht mehr
// global - der Fallback behaelt seinen ALTEN Sockel 3000ms (Bestand), NUR 'de' hat den
// niedrigeren, gemessenen Sockel 1500ms (s. F5). MAX bleibt der einzige weiterhin globale Wert
// (verlaengert nur, kann also nie abschneiden).
//
// PROMPT-21 (i18n-Launch-Testkatalog, tasks/i18n-tests/02-llm-prompts.md). Der Katalogfall
// ("nur 'de' ist vermessen; EN/FR nutzen die alte, ungemessene Fallback-Kalibrierung, X != Y
// bei identischer Zeichenzahl") ist durch F7 (de, 100 Zeichen -> 7000 ms) zusammen mit F10
// (en/fr/undefined, 100 Zeichen -> 8500 ms) und F11/F12 exakt abgedeckt. Referenz statt
// Duplikat (G5); die Kalibrierungs-Luecke selbst ist ein bewusst getragenes Risiko
// (19-w2-baseline.md 7).
test("F10: en/fr/undefined bekommen die ALTEN Fallback-Konstanten (1500ms + 70ms/Zeichen, minMs 3000ms) - Regressionsschutz gegen R4", () => {
  const { call, watchdog } = setup();

  for (const language of ["en", "fr", undefined, "unbekannt-xyz"]) {
    const { delayMs } = watchdog.scheduleFarewellHangup(call.id, { speechChars: 100, language });
    assert.equal(delayMs, 8500, `language=${language}: erwartet altes Bestandsverhalten (8500ms)`);
  }

  // Untergrenze: der Fallback-Sockel bleibt bei 3000ms (Bestand) - NUR 'de' hat den niedrigeren,
  // gemessenen Sockel 1500ms (F5). Obergrenze (MAX) bleibt sprachunabhaengig global (15000ms).
  const { delayMs: min } = watchdog.scheduleFarewellHangup(call.id, { speechChars: 0, language: "en" });
  assert.equal(min, 3000);
  const { delayMs: max } = watchdog.scheduleFarewellHangup(call.id, { speechChars: 1000, language: "fr" });
  assert.equal(max, 15_000);
});

// F11 (S3-7): der Guard fuer defekte Zeichenzahlen (NaN/negativ) MUSS auf den minMs DER
// JEWEILIGEN KALIBRIERUNG fallen (de: 1500ms, Fallback: 3000ms - s. F10/MAJOR-1). Ohne den
// Number.isFinite-Guard reicht Math.min/max NaN durch, und setTimeout(NaN) feuert SOFORT = ein
// abgeschnittener Abschied (R4).
test("F11: NaN/negative Zeichenzahl faellt auf den minMs der jeweiligen Kalibrierung (de: 1500, Fallback: 3000)", () => {
  const { call, watchdog } = setup();

  const { delayMs: nanDe } = watchdog.scheduleFarewellHangup(call.id, { speechChars: NaN, language: "de" });
  assert.equal(nanDe, 1500);

  const { delayMs: negativeDe } = watchdog.scheduleFarewellHangup(call.id, {
    speechChars: -50,
    language: "de",
  });
  assert.equal(negativeDe, 1500);

  const { delayMs: nanFallback } = watchdog.scheduleFarewellHangup(call.id, { speechChars: NaN, language: "en" });
  assert.equal(nanFallback, 3000);
});

// F12 (MAJOR-1, Pflicht-Regressionstest der 2. Review-Runde): der Fallback (jede Sprache ausser
// 'de') darf fuer KEINE Zeichenzahl KUERZER sein als das alte, in Produktion bewaehrte
// Bestandsverhalten clamp(1500 + 70*c, 3000, 12000). Ein kuerzerer Fallback wuerde einen
// kurzen englischen/franzoesischen Abschiedssatz abschneiden - exakt die Richtung von R4.
// oldFarewellFormula() wird bewusst NICHT aus der SUT importiert (Test-Orakel, s.
// Kopf-Kommentar), sondern lokal aus der historischen, VOR K3 gueltigen Formel nachgebaut.
function oldFarewellFormula(chars) {
  const OLD_BASE_MS = 1500;
  const OLD_MS_PER_CHAR = 70;
  const OLD_MIN_MS = 3000;
  const OLD_MAX_MS = 12_000;
  return Math.min(Math.max(OLD_BASE_MS + chars * OLD_MS_PER_CHAR, OLD_MIN_MS), OLD_MAX_MS);
}

test("F12: Fallback (en) unterschreitet NIE die alte Bestandsformel - fuer eine Reihe von Zeichenzahlen", () => {
  const { call, watchdog } = setup();

  for (const chars of [0, 1, 8, 17, 21, 50, 162, 206, 300]) {
    const { delayMs } = watchdog.scheduleFarewellHangup(call.id, { speechChars: chars, language: "en" });
    const oldDelay = oldFarewellFormula(chars);
    assert.ok(
      delayMs >= oldDelay,
      `chars=${chars}: neuer Fallback ${delayMs}ms unterschreitet die alte Formel ${oldDelay}ms`,
    );
  }
});

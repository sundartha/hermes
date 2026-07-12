// Akzeptanztests fuer afix-p3 (tasks/assistant-fix-spec.md P3, RCA R4): Farewell-Hangup im
// Conversation-Watchdog. Verdrahtet den ECHTEN Watchdog (makeConversationWatchdog) + das
// ECHTE Terminierungs-Primitiv (makeCallControlTerminator) gegen einen Fake-Store/-VoiceControl/
// -Timer (kein Netz/Spawn, injizierte Zeit, F.I.R.S.T.) - EINE Ebene tiefer als
// telnyx-shim-endcall.test.js (dort wird der Shim-Kontrakt geprueft, hier die Watchdog-Logik
// selbst: Suspendierung/Cancel/Clamp/Idempotenz). Erwartungswerte bewusst hart kodiert
// (Test-Orakel; ein Import der SUT-Konstanten wuerde einen falschen Wert mit-durchwinken).
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
  watchdog.scheduleFarewellHangup(call.id, 20);
  timers.fireAll();
  await Promise.resolve(); // terminate() ist async (Promise.resolve(terminate(...)).catch)

  assert.deepEqual(voiceControl.calls, [{ provider: "telnyx", callControlId: call.callControlId }]);
});

test("F2: Dead-Air ist waehrend des Delays suspendiert (Timer ersetzt, kein dead_air-Log)", async () => {
  const { call, timers, watchdog } = setup();

  watchdog.arm(call.id);
  assert.deepEqual(timers.pendingDelays(), [DEAD_AIR_TEST_MS], "Dead-Air-Timer initial gestellt");

  const { delayMs } = watchdog.scheduleFarewellHangup(call.id, 20);
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
  watchdog.scheduleFarewellHangup(call.id, 20);
  watchdog.observeTurn(call.id, SUBSTANTIAL_TEXT);

  assert.deepEqual(timers.pendingDelays(), [DEAD_AIR_TEST_MS], "Farewell weg, Dead-Air wieder scharf");

  watchdog.clear(call.id);
  timers.fireAll();
  assert.equal(voiceControl.calls.length, 0, "kein Hangup - der Abschied war verfrueht");
});

test("F4: clear waehrend des Delays (externer Hangup gewinnt) - kein zweites terminate", async () => {
  const { call, voiceControl, timers, watchdog } = setup();

  watchdog.arm(call.id);
  watchdog.scheduleFarewellHangup(call.id, 20);
  watchdog.clear(call.id);

  assert.equal(timers.pendingCount(), 0, "beide Timer geraeumt");
  timers.fireAll();
  assert.equal(voiceControl.calls.length, 0, "kein zweiter Hangup-Versuch auf einen bereits beendeten Call");
});

test("F5: Clamp Untergrenze - 0 Zeichen -> FAREWELL_MIN_MS", () => {
  const { call, watchdog } = setup();
  const { delayMs } = watchdog.scheduleFarewellHangup(call.id, 0);
  assert.equal(delayMs, 3000);
});

test("F6: Clamp Obergrenze - 1000 Zeichen -> FAREWELL_MAX_MS", () => {
  const { call, watchdog } = setup();
  const { delayMs } = watchdog.scheduleFarewellHangup(call.id, 1000);
  assert.equal(delayMs, 12_000);
});

test("F7: Formel greift zwischen den Grenzen - 100 Zeichen -> 1500 + 100*70", () => {
  const { call, watchdog } = setup();
  const { delayMs } = watchdog.scheduleFarewellHangup(call.id, 100);
  assert.equal(delayMs, 8500);
});

test("F8: zweiter scheduleFarewellHangup fuer denselben Call ersetzt den Timer (nie zwei Terminierungen)", async () => {
  const { call, voiceControl, timers, watchdog } = setup();

  watchdog.scheduleFarewellHangup(call.id, 20);
  watchdog.scheduleFarewellHangup(call.id, 20);
  assert.equal(timers.pendingCount(), 1, "kein zweiter, paralleler Timer");

  timers.fireAll();
  await Promise.resolve();
  assert.equal(voiceControl.calls.length, 1, "genau ein Hangup");
});

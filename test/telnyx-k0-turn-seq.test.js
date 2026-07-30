// Tests fuer K0 (PLAN-CONVERSATION-OPTIMIZATION.md, Messgrundlage): Shim-Request-Zaehler
// pro Call ("turnSeq"). Der Zaehler lebt bewusst NICHT in einer neuen globalen Map, sondern
// im bereits vorhandenen per-callId-Zustand von telnyx-conversation-watchdog.js (states-Map,
// dort seit stab-p9 ueber clear()/terminateOnce() aufgeraeumt) - K0-3 beweist, dass er beim
// Aufraeumen mit entsorgt wird (kein Leck). K0-1/K0-2 pruefen die reine Zaehl-Logik direkt
// gegen makeConversationWatchdog (kein Netz/Store/voiceControl noetig). K0-4/K0-5 beweisen
// die end-to-end-Verdrahtung in die turn_ok-Logzeile des Shims (Muster
// telnyx-stab-p9-watchdog.test.js: echte Factories, injizierte Fake-Timer, kein Mock der
// Kern-Logik).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConversationWatchdog } from "../src/telnyx-conversation-watchdog.js";
import { makeTelnyxLlmShim } from "../src/telnyx-llm-shim.js";
import { localeFor } from "../src/i18n/locales.js";
import { captureConsole } from "./helpers.js";
import { fakeTelnyxShimConfig } from "./config-namespaces-helper.js";
import {
  fakeStore,
  makeCall,
  validReq,
  fakeRes,
  agentTurnSpy,
  fakeTimers,
  makeTestWatchdog,
  WATCHDOG_TEST_CONFIG,
} from "./telnyx-shim-harness.js";

// Voller Satz statt Kuerzel (Muster telnyx-stab-p9-watchdog.test.js): robust gegen
// isSubstantialCallerText, das den echten config.js-Singleton liest, nicht WATCHDOG_TEST_CONFIG.
const SUBSTANTIAL_TEXT = "Ja, das passt mir gut, vielen Dank fuer den Rueckruf naechste Woche.";

// Reiner Watchdog-Test ohne Shim/Store/voiceControl: terminate wird in K0-1..K0-3 nie
// aufgerufen (kein Notaus-Pfad geuebt), bleibt aber Pflichtargument der Fabrik.
function watchdogForCounterTests() {
  const timers = fakeTimers();
  return makeConversationWatchdog({
    config: WATCHDOG_TEST_CONFIG,
    terminate: async () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
}

test("K0-1: observeTurn liefert eine 1-basiert steigende turnSeq fuer denselben Call", () => {
  const watchdog = watchdogForCounterTests();

  const r1 = watchdog.observeTurn("call_a", SUBSTANTIAL_TEXT);
  const r2 = watchdog.observeTurn("call_a", SUBSTANTIAL_TEXT);
  const r3 = watchdog.observeTurn("call_a", SUBSTANTIAL_TEXT);

  assert.equal(r1.turnSeq, 1);
  assert.equal(r2.turnSeq, 2);
  assert.equal(r3.turnSeq, 3);
});

test("K0-2: zwei verschiedene Calls fuehren unabhaengige turnSeq-Zaehler (kein geteilter Zustand)", () => {
  const watchdog = watchdogForCounterTests();

  watchdog.observeTurn("call_a", SUBSTANTIAL_TEXT);
  watchdog.observeTurn("call_a", SUBSTANTIAL_TEXT);
  const rb = watchdog.observeTurn("call_b", SUBSTANTIAL_TEXT);

  assert.equal(rb.turnSeq, 1, "call_b startet bei 1, unbeeinflusst vom Zaehlerstand von call_a");
});

test("K0-3: clear() raeumt den Zaehler vollstaendig ab - dieselbe callId beginnt danach wieder bei 1 (kein Leck)", () => {
  const watchdog = watchdogForCounterTests();

  watchdog.observeTurn("call_a", SUBSTANTIAL_TEXT);
  watchdog.observeTurn("call_a", SUBSTANTIAL_TEXT);
  watchdog.clear("call_a");

  const after = watchdog.observeTurn("call_a", SUBSTANTIAL_TEXT);

  assert.equal(
    after.turnSeq,
    1,
    "State (inkl. turnSeq) wurde bei clear() komplett entfernt, kein Ueberbleibsel aus vorherigen Turns",
  );
});

test("K0-4: end-to-end ueber den Shim - die turn_ok-Logzeile traegt turnSeq, steigt ueber mehrere Turns desselben Calls", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const voiceControl = () => ({ endCallViaCallControl: async () => {} });
  const agentTurn = agentTurnSpy();
  const timers = fakeTimers();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers });
  const handler = makeTelnyxLlmShim({
    store,
    config: fakeTelnyxShimConfig(),
    agentTurn,
    localeFor,
    voiceControl,
    watchdog,
  });
  const req = () => validReq(call, { messages: [{ role: "user", content: SUBSTANTIAL_TEXT }] });
  const findTurnOk = (lines) => lines.find((l) => l.includes("[telnyx-shim] turn_ok"));

  const lines1 = await captureConsole(() => handler(req(), fakeRes()));
  const lines2 = await captureConsole(() => handler(req(), fakeRes()));

  const turnOk1 = findTurnOk(lines1);
  const turnOk2 = findTurnOk(lines2);
  assert.ok(turnOk1, "turn_ok-Zeile fuer den ersten Turn fehlt");
  assert.ok(turnOk2, "turn_ok-Zeile fuer den zweiten Turn fehlt");
  assert.ok(turnOk1.includes('"turnSeq":1'));
  assert.ok(turnOk2.includes('"turnSeq":2'));
});

test("K0-5: zwei verschiedene Calls im selben Shim fuehren eigene turnSeq-Reihen in der turn_ok-Zeile", async () => {
  const callA = makeCall({ id: "call_A", callControlId: "cc_A" });
  const callB = makeCall({ id: "call_B", callControlId: "cc_B" });
  const store = {
    getCallByControlId: (ccid) => [callA, callB].find((c) => c.callControlId === ccid) || null,
    getCall: (id) => [callA, callB].find((c) => c.id === id) || null,
    budgetExceeded: () => false,
  };
  const voiceControl = () => ({ endCallViaCallControl: async () => {} });
  const agentTurn = agentTurnSpy();
  const timers = fakeTimers();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers });
  const handler = makeTelnyxLlmShim({
    store,
    config: fakeTelnyxShimConfig(),
    agentTurn,
    localeFor,
    voiceControl,
    watchdog,
  });
  const findTurnOk = (lines) => lines.find((l) => l.includes("[telnyx-shim] turn_ok"));
  const substReq = (call) => validReq(call, { messages: [{ role: "user", content: SUBSTANTIAL_TEXT }] });

  const linesA1 = await captureConsole(() => handler(substReq(callA), fakeRes()));
  const linesB1 = await captureConsole(() => handler(substReq(callB), fakeRes()));
  const linesA2 = await captureConsole(() => handler(substReq(callA), fakeRes()));

  assert.ok(findTurnOk(linesA1).includes('"turnSeq":1'));
  assert.ok(findTurnOk(linesB1).includes('"turnSeq":1'), "call_B startet unabhaengig bei 1");
  assert.ok(findTurnOk(linesA2).includes('"turnSeq":2'), "call_A zaehlt eigenstaendig weiter");
});

// S3-6 (Review-Befund): K0-3 beweist den Zaehler-Reset nur ueber den EXPLIZITEN clear()-Pfad
// (externer Hangup). terminateOnce() (Dead-Air-/Farewell-Notaus) raeumt denselben states-
// Eintrag ueber einen ANDEREN Code-Pfad ab (states.delete VOR dem eigentlichen terminate()-
// Aufruf, s. telnyx-conversation-watchdog.js) - ohne einen eigenen Test dafuer waere das nur
// per Lesen, nicht per Beweis abgesichert.
test("K0-6: dead_air (terminateOnce) raeumt den Zaehler wie clear() - kein Leck ueber den Notaus-Pfad", () => {
  const timers = fakeTimers();
  const watchdog = makeConversationWatchdog({
    config: WATCHDOG_TEST_CONFIG,
    terminate: async () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  watchdog.arm("call_a");
  watchdog.observeTurn("call_a", SUBSTANTIAL_TEXT);
  watchdog.observeTurn("call_a", SUBSTANTIAL_TEXT);
  timers.fireAll(); // Dead-Air-Timer feuert -> onDeadAir -> terminateOnce loescht den State

  const after = watchdog.observeTurn("call_a", SUBSTANTIAL_TEXT);
  assert.equal(
    after.turnSeq,
    1,
    "turnSeq wurde bei terminateOnce (Dead-Air) komplett entfernt, kein Ueberbleibsel",
  );
});

test("K0-7: Farewell-Feuern (terminateOnce) raeumt den Zaehler wie clear() - kein Leck ueber den Notaus-Pfad", () => {
  const timers = fakeTimers();
  const watchdog = makeConversationWatchdog({
    config: WATCHDOG_TEST_CONFIG,
    terminate: async () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  watchdog.observeTurn("call_a", SUBSTANTIAL_TEXT);
  watchdog.observeTurn("call_a", SUBSTANTIAL_TEXT);
  watchdog.scheduleFarewellHangup("call_a", { speechChars: 20, language: "de" });
  timers.fireAll(); // Farewell-Timer feuert -> onFarewellDue -> terminateOnce loescht den State

  const after = watchdog.observeTurn("call_a", SUBSTANTIAL_TEXT);
  assert.equal(
    after.turnSeq,
    1,
    "turnSeq wurde bei terminateOnce (Farewell) komplett entfernt, kein Ueberbleibsel",
  );
});

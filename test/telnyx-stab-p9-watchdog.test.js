// Akzeptanztests fuer stab-p9 (PLAN-STABILIZE-LAUNCH.md P9, Kosten-Notaus): Dead-Air-/
// Loop-Watchdog. Verdrahtet die ECHTEN Module (makeTelnyxLlmShim, makeCallControlIngest,
// makeConversationWatchdog, makeCallControlTerminator) - nur Store/voiceControl/Timer sind
// Fakes. Beweist damit sowohl die Logik ALS AUCH die Prod-Verdrahtung (server.js nutzt
// dieselben Factories) - ein vergessenes arm/observeTurn/clear waere hier sofort sichtbar
// (G4-Gegenprobe: kein still abgeschaltetes Kosten-Notaus). Kein Netz/Spawn, injizierte
// Zeit (F.I.R.S.T.).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTelnyxLlmShim } from "../src/telnyx-llm-shim.js";
import { makeCallControlIngest } from "../src/telnyx-call-control-ingest.js";
import { makeConversationWatchdog, WATCHDOG_LOG_PREFIX } from "../src/telnyx-conversation-watchdog.js";
import { makeCallControlTerminator } from "../src/telnyx-call-terminate.js";
import { localeFor } from "../src/i18n/locales.js";
import { fakeStore, makeCall, validReq, fakeRes, sseContent, agentTurnSpy } from "./telnyx-shim-harness.js";
import { fakeTelnyxShimConfig, captureConsole } from "./helpers.js";

// Kompaktes N/M fuer schnelle, lesbare Tests (config.js-Defaults 45s/8 waeren nur langsamer
// zu lesen, nicht anders zu pruefen - die Watchdog-Logik ist schwellenwert-agnostisch).
const WATCHDOG_CONFIG = { telnyxDeadAirTimeoutS: 30, telnyxLoopGuardMaxEmptyTurns: 3 };

// Voller Satz statt Kuerzel: robust gegen eine lokal geleakte CALLER_SUBSTANCE_MIN_LEN
// (isSubstantialCallerText liest den echten config.js-Singleton, nicht WATCHDOG_CONFIG).
const SUBSTANTIAL_TEXT = "Ja, das passt mir gut, vielen Dank fuer den Rueckruf naechste Woche.";

// Deterministischer Fake-Timer (P12 Fast/Repeatable): setTimer/clearTimer injiziert statt
// echter Wartezeit. fireAll() feuert alle noch ausstehenden Callbacks synchron.
function fakeTimers() {
  const pending = [];
  let nextId = 1;
  const cleared = [];
  return {
    setTimer(fn) {
      const id = nextId++;
      pending.push({ id, fn });
      return id;
    },
    clearTimer(id) {
      cleared.push(id);
      const i = pending.findIndex((p) => p.id === id);
      if (i >= 0) pending.splice(i, 1);
    },
    fireAll() {
      pending.splice(0).forEach((p) => p.fn());
    },
    pendingCount: () => pending.length,
    clearedCount: () => cleared.length,
  };
}

// Kombinierter voiceControl-Spy: deckt speak (Ingest onAnswered) + startAssistant (Ingest
// onSpeakEnded) + endCallViaCallControl (Watchdog-Terminierung + Shim-Hangup) unter EINEM
// Fake ab - in Produktion teilen sich alle drei Aufrufer denselben voiceControl-Port.
function fakeVoiceControl() {
  const calls = [];
  function voiceControl(provider) {
    return {
      async speak(p) {
        calls.push({ op: "speak", provider, ...p });
      },
      async startAssistant(p) {
        calls.push({ op: "startAssistant", provider, ...p });
      },
      async endCallViaCallControl(callControlId) {
        calls.push({ op: "hangup", provider, callControlId });
      },
    };
  }
  voiceControl.calls = calls;
  return voiceControl;
}

// Minimaler Ingest-res-Fake (sendStatus statt status/json/write - andere Kontrakt-Form als
// der Shim-Response, Muster telnyx-event-ingest-machine.test.js).
function ingestRes() {
  return {
    statusSent: null,
    sendStatus(code) {
      this.statusSent = code;
      return this;
    },
  };
}

function speakEndedBody(callControlId) {
  return { data: { event_type: "call.speak.ended", payload: { call_control_id: callControlId } } };
}
function speakFailedBody(callControlId) {
  return {
    data: { event_type: "call.speak.ended", payload: { call_control_id: callControlId, status: "failed" } },
  };
}
function hangupBody(callControlId) {
  return { data: { event_type: "call.hangup", payload: { call_control_id: callControlId } } };
}

// Baut Watchdog + geteiltes Terminierungs-Primitiv aus den ECHTEN Factories (kein Mock der
// Kern-Logik) gegen einen gegebenen Fake-Store/-VoiceControl/-Timer (Build-Schritt, P13).
function makeTestWatchdog({ store, voiceControl, timers }) {
  const terminate = makeCallControlTerminator({ store, voiceControl, logPrefix: WATCHDOG_LOG_PREFIX });
  return makeConversationWatchdog({
    config: WATCHDOG_CONFIG,
    terminate,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
}

test("T1: Loop-Guard feuert bei M=3 konsekutiven Leer-Turns - kein Token-Burn auf dem Kill-Turn, realer Hangup", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const voiceControl = fakeVoiceControl();
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
  const emptyReq = () => validReq(call, { messages: [{ role: "user", content: "" }] });

  await handler(emptyReq(), fakeRes());
  await handler(emptyReq(), fakeRes());
  const res3 = fakeRes();
  const lines = await captureConsole(() => handler(emptyReq(), res3));

  assert.equal(agentTurn.calls.length, 2, "kein dritter agentTurn-Aufruf - Loop-Guard griff VOR dem Kern");
  assert.equal(sseContent(res3), localeFor("de").llmDegradedSpeech);
  const hangupCalls = voiceControl.calls.filter((c) => c.op === "hangup");
  assert.equal(hangupCalls.length, 1, "realer Call-Control-Hangup ausgeloest");
  assert.equal(hangupCalls[0].provider, "telnyx");
  assert.equal(hangupCalls[0].callControlId, call.callControlId);
  assert.ok(lines.some((l) => l.includes('"reason":"loop_guard"')), "Gate-Log reason=loop_guard fehlt");
});

test("T2: substanzielle Turns loesen den Loop-Guard NIE aus (Normalfluss)", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const voiceControl = fakeVoiceControl();
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
  const substantialReq = () => validReq(call, { messages: [{ role: "user", content: SUBSTANTIAL_TEXT }] });

  for (let i = 0; i < 4; i++) {
    await handler(substantialReq(), fakeRes());
  }

  assert.equal(agentTurn.calls.length, 4, "jeder Turn erreichte den Kern");
  assert.equal(voiceControl.calls.filter((c) => c.op === "hangup").length, 0, "kein Loop-Guard-Hangup");
});

test("T3: Dead-Air feuert nach N Sekunden (echter Ingest + echter Watchdog, Fake-Timer)", async () => {
  const call = makeCall({ assistantId: "asst_1" });
  const store = fakeStore({ call });
  const voiceControl = fakeVoiceControl();
  const timers = fakeTimers();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers });
  const ingest = makeCallControlIngest({
    store,
    voiceControl,
    finishCall: async () => {},
    openingText: () => "Opening",
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog,
  });

  await ingest({ query: { callId: call.id }, body: speakEndedBody(call.callControlId) }, ingestRes());
  assert.equal(timers.pendingCount(), 1, "arm hat genau einen Dead-Air-Timer gestellt");

  const lines = await captureConsole(() => {
    timers.fireAll();
    return Promise.resolve();
  });

  const hangupCalls = voiceControl.calls.filter((c) => c.op === "hangup");
  assert.equal(hangupCalls.length, 1, "Dead-Air-Timeout terminiert den Call");
  assert.equal(hangupCalls[0].callControlId, call.callControlId);
  assert.ok(
    lines.some((l) => l.startsWith(WATCHDOG_LOG_PREFIX) && l.includes("dead_air") && l.includes(call.id)),
    "dead_air-Log (PII-frei, nur callId) fehlt",
  );
});

test("T4: kein Arm ohne gehoerte Offenlegung (Regel-2-Paritaet, speak.ended status=failed)", async () => {
  const call = makeCall({ assistantId: "asst_1" });
  const store = fakeStore({ call });
  const voiceControl = fakeVoiceControl();
  const timers = fakeTimers();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers });
  const ingest = makeCallControlIngest({
    store,
    voiceControl,
    finishCall: async () => {},
    openingText: () => "Opening",
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog,
  });

  await ingest({ query: { callId: call.id }, body: speakFailedBody(call.callControlId) }, ingestRes());

  assert.equal(timers.pendingCount(), 0, "keine Offenlegung gehoert -> keine Dead-Air-Wache");
});

test("T5: reguläre Turns fuettern die Wache - Timer wird ersetzt, nicht gestapelt (keine Fehlausloesung)", async () => {
  const call = makeCall({ assistantId: "asst_1" });
  const store = fakeStore({ call });
  const voiceControl = fakeVoiceControl();
  const timers = fakeTimers();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers });

  watchdog.arm(call.id);
  assert.equal(timers.pendingCount(), 1);

  watchdog.observeTurn(call.id, SUBSTANTIAL_TEXT);

  assert.equal(timers.pendingCount(), 1, "genau ein Timer nach dem Turn (ersetzt, nicht gestapelt)");
  assert.equal(timers.clearedCount(), 1, "alter Timer wurde beim Fuettern gecleart");
});

test("T6: clear bei hangup stoppt die Wache (kein spurioser Dead-Air-Hangup nach normalem Call-Ende)", async () => {
  const call = makeCall({ assistantId: "asst_1" });
  const store = fakeStore({ call });
  const voiceControl = fakeVoiceControl();
  const timers = fakeTimers();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers });
  const ingest = makeCallControlIngest({
    store,
    voiceControl,
    finishCall: async () => {},
    openingText: () => "Opening",
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog,
  });

  watchdog.arm(call.id);
  assert.equal(timers.pendingCount(), 1);

  await ingest({ query: { callId: call.id }, body: hangupBody(call.callControlId) }, ingestRes());
  assert.equal(timers.pendingCount(), 0, "clear hat den Dead-Air-Timer entfernt");

  timers.fireAll();
  assert.equal(voiceControl.calls.filter((c) => c.op === "hangup").length, 0, "kein spurioser Watchdog-Hangup");
});

test("T7: arm ist idempotent (zweimal armieren => genau ein Timer); Feuern raeumt State, zweites Feuern wirkungslos", async () => {
  const call = makeCall({ assistantId: "asst_1" });
  const store = fakeStore({ call });
  const voiceControl = fakeVoiceControl();
  const timers = fakeTimers();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers });

  watchdog.arm(call.id);
  watchdog.arm(call.id);
  assert.equal(timers.pendingCount(), 1, "zweites arm ersetzt den Timer, keine zwei parallelen Timer");

  timers.fireAll();
  assert.equal(voiceControl.calls.filter((c) => c.op === "hangup").length, 1);
  assert.equal(timers.pendingCount(), 0, "State nach Feuern entfernt (one-shot)");

  timers.fireAll(); // nichts mehr pending -> No-op
  assert.equal(voiceControl.calls.filter((c) => c.op === "hangup").length, 1, "kein Doppel-Terminate");
});

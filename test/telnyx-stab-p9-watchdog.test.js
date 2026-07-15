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
import { WATCHDOG_LOG_PREFIX } from "../src/telnyx-conversation-watchdog.js";
import { localeFor } from "../src/i18n/locales.js";
import { config } from "../src/config.js";
import {
  fakeStore,
  makeCall,
  validReq,
  fakeRes,
  sseContent,
  agentTurnSpy,
  fakeTimers,
  makeTestWatchdog,
  ingestTimeoutDeps,
} from "./telnyx-shim-harness.js";
import { fakeTelnyxShimConfig, captureConsole, makeConfigOverrides } from "./helpers.js";

// Voller Satz statt Kuerzel: robust gegen eine lokal geleakte CALLER_SUBSTANCE_MIN_LEN
// (isSubstantialCallerText liest den echten config.js-Singleton, nicht WATCHDOG_TEST_CONFIG).
const SUBSTANTIAL_TEXT = "Ja, das passt mir gut, vielen Dank fuer den Rueckruf naechste Woche.";

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

// afix-timeout-caller-gap (Review-Blocker Runde 2): makeCallControlIngest macht config zur
// Pflicht-Dependency (kein Default, anders als setTimer/clearTimer mit defaultSetTimer/
// clearTimeout) - ohne diese Deps wuerde ein spaeter hier reichender assistantVoiceConfigured()
// = true-Pfad (Retry-Zweig in onSpeakFailed) armOpeningSpeakTimeout() mit einem TypeError auf
// config.telnyxAssistant.openingSpeakTimeoutS crashen lassen, den der Handler-catch (handleCallControlEvent)
// nur still nach console.error verschluckt - diese Testdatei haette das NIE bemerkt.
// G5-TEST-DUP (Review-Blocker Runde 3): ingestTimeoutDeps() jetzt zentral in
// telnyx-shim-harness.js (Import oben), statt hier byte-identisch zu
// telnyx-event-ingest-machine.test.js dupliziert zu sein.

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
    ...ingestTimeoutDeps(),
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
    "dead_air-Log (PII-frei, callId+turnSeq) fehlt",
  );
  // MINOR-2 (2. Review-Runde): dead_air trug bisher nur callId - turnSeq fehlte, obwohl der
  // State es an dieser Stelle bereits kannte. Hier arm() ohne vorherigen observeTurn -> turnSeq
  // steht noch auf dem Initialwert 0.
  assert.ok(
    lines.some((l) => l.startsWith(WATCHDOG_LOG_PREFIX) && l.includes("dead_air") && l.includes('"turnSeq":0')),
    "dead_air-Log traegt kein turnSeq",
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
    ...ingestTimeoutDeps(),
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
    ...ingestTimeoutDeps(),
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

// T8-T10 (Review-Blocker P9-WD1, T10 seit afix-p3 angepasst): observeTurn (Schritt 4.6)
// armiert den Dead-Air-Timer auf JEDEM Turn VOR den drei shim-getriebenen Terminierungspfaden -
// im Moment der Terminierung ist der Timer also immer frisch gestellt. Ohne ein Loeschen/
// Ersetzen direkt an der Terminierungsstelle wuerde dieser Timer ueberleben und spaeter ein
// ZWEITES Mal feuern (zweiter Hangup-Versuch + irrefuehrendes dead_air-Log fuer einen bereits
// anders beendeten Call). T8/T9 (Notaus, sofortiges terminate+clear): kein Timer mehr pending.
// T10 (end_call, verzoegertes terminate): der Dead-Air-Timer wird durch den Farewell-Timer
// ERSETZT (Suspendierung, afix-p3) statt geloescht - trotzdem loest ein nachtraegliches
// fireAll() in keinem der drei Faelle einen zweiten Hangup aus.
test("T8: Loop-Guard-Terminierung raeumt den Dead-Air-Timer (kein spurioses zweites Feuern)", async () => {
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
  await handler(emptyReq(), fakeRes()); // dritter Leer-Turn -> Loop-Guard feuert (M=3)

  assert.equal(timers.pendingCount(), 0, "Dead-Air-Timer nach Loop-Guard-Terminierung geraeumt");
  timers.fireAll(); // No-op, falls die Wache sauber geraeumt ist
  assert.equal(
    voiceControl.calls.filter((c) => c.op === "hangup").length,
    1,
    "kein zweiter (spurioser) Hangup nach dem Loop-Guard-Hangup",
  );
});

test("T9: Budget-Gate-Terminierung raeumt den Dead-Air-Timer (kein spurioses zweites Feuern)", async () => {
  const call = makeCall();
  const store = fakeStore({ call, budgetExceeded: true });
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

  await handler(validReq(call, { messages: [{ role: "user", content: SUBSTANTIAL_TEXT }] }), fakeRes());

  assert.equal(agentTurn.calls.length, 0, "Budget-Gate griff VOR dem Kern - kein Token-Burn");
  assert.equal(timers.pendingCount(), 0, "Dead-Air-Timer nach Budget-Terminierung geraeumt");
  timers.fireAll();
  assert.equal(
    voiceControl.calls.filter((c) => c.op === "hangup").length,
    1,
    "kein zweiter (spurioser) Hangup nach dem Budget-Hangup",
  );
});

test("T10: end_call plant den Hangup verzoegert (afix-p3) - Dead-Air suspendiert, kein Doppel-Hangup", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const voiceControl = fakeVoiceControl();
  const agentTurn = agentTurnSpy({ speech: "Auf Wiederhoeren.", endCall: true });
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

  await handler(validReq(call, { messages: [{ role: "user", content: SUBSTANTIAL_TEXT }] }), fakeRes());

  assert.equal(agentTurn.calls.length, 1);
  assert.equal(voiceControl.calls.filter((c) => c.op === "hangup").length, 0, "kein sofortiger Hangup");
  assert.deepEqual(
    timers.pendingDelays(),
    [1605], // K3: 500ms Basis + 17 Zeichen ("Auf Wiederhoeren.") * 65ms/Zeichen
    "Dead-Air-Timer durch den Farewell-Timer ersetzt (suspendiert), nicht daneben gestellt",
  );

  timers.fireAll();
  assert.equal(voiceControl.calls.filter((c) => c.op === "hangup").length, 1, "Farewell-Timer terminiert");

  timers.fireAll(); // nichts mehr pending -> No-op
  assert.equal(
    voiceControl.calls.filter((c) => c.op === "hangup").length,
    1,
    "kein zweiter (spurioser) Hangup nach dem end_call-Hangup",
  );
});

// T11 (Review-Blocker Runde 2, afix-timeout-caller-gap): diese Datei liefert assistantVoiceConfigured()
// sonst IMMER false (ElevenLabs-Env in BASE_ENV leer) - der Retry-Zweig in onSpeakFailed, der
// armOpeningSpeakTimeout() erreicht, wurde hier also nie durchlaufen und ein fehlendes config
// waere nie aufgefallen (TypeError landet nur still im Handler-catch). Dieser Test schaltet
// ElevenLabs bewusst per withConfig auf konfiguriert um und beweist, dass der Retry-Pfad den
// Opening-Speak-Timer erfolgreich (ohne TypeError) armiert, WEIL config jetzt injiziert ist.
test("T11: Retry-Pfad mit konfigurierter Assistant-Stimme armiert den Opening-Speak-Timer (kein stiller TypeError aus fehlendem config)", async () => {
  const call = makeCall({ assistantId: "asst_1" });
  const store = fakeStore({ call });
  const voiceControl = fakeVoiceControl();
  const timers = fakeTimers();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers });
  const openingTimers = fakeTimers();
  const ingest = makeCallControlIngest({
    store,
    voiceControl,
    finishCall: async () => {},
    openingText: () => "Opening",
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog,
    config,
    setTimer: openingTimers.setTimer,
    clearTimer: openingTimers.clearTimer,
  });
  const { withConfig } = makeConfigOverrides(config);
  const elevenLabsConfigured = { voiceId: "voice_el_1", apiKeyRef: "elevenlabs_ref" };

  await withConfig("telnyxElevenLabs", elevenLabsConfigured, () =>
    ingest({ query: { callId: call.id }, body: speakFailedBody(call.callControlId) }, ingestRes()),
  );

  assert.equal(voiceControl.calls.filter((c) => c.op === "speak").length, 1, "Retry-Speak wurde abgesetzt");
  assert.equal(
    openingTimers.pendingCount(),
    1,
    "Opening-Speak-Timer nach dem Retry armiert - ohne config wuerde dieser Aufruf VOR setTimer werfen und der Timer bliebe unarmiert",
  );
});

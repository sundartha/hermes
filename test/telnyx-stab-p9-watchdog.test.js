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
  fakeClock,
  makeTestWatchdog,
  ingestTimeoutDeps,
  DEAD_AIR_TEST_MS,
} from "./telnyx-shim-harness.js";
import { captureConsole, makeConfigOverrides } from "./helpers.js";
import { fakeTelnyxShimConfig } from "./config-namespaces-helper.js";

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

// T12-T17 (dead-air-speech): der Dead-Air-Notaus kannte bisher nur den ANRUFER als
// Lebenszeichen und kappte lange Agentenantworten mitten im Satz. Diese Tests fahren den
// ECHTEN Shim + echten Watchdog mit einer STEUERBAREN Uhr (fakeClock) - der Waechter fragt
// beim Feuern, wie viel der geschaetzten Sprechdauer noch aussteht.

// 1000 Zeichen: mit der de-Kalibrierung (500 ms Anlauf + 65 ms/Zeichen) 65,5 s Sprechzeit -
// weit ueber der 30-s-Testfrist, also genau der Live-Fall (ein Vorlesen/Aufzaehlen).
const LONG_SPEECH = "A".repeat(1000);
const LONG_SPEECH_MS = 65_500;
// Deckel der Sprech-Verlaengerung (Modul-Konstante SPEECH_EXTENSION_MAX_MS, nicht exportiert -
// hier als Erwartungswert dupliziert, weil ausschliesslich dieser Test ihn braucht).
const SPEECH_EXTENSION_MAX_MS_EXPECTED = 90_000;

// Baut Call/Store/VoiceControl/Uhr/Timer/Watchdog/Handler fuer die Sprech-Verlaengerungs-
// Tests (P13) - ein Turn mit dem gegebenen Sprechtext ist der einzige variable Teil.
function setupSpeechTurn(speech) {
  const call = makeCall();
  const store = fakeStore({ call });
  const voiceControl = fakeVoiceControl();
  const agentTurn = agentTurnSpy({ speech, endCall: false });
  const timers = fakeTimers();
  const clock = fakeClock();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers, now: clock.now });
  const handler = makeTelnyxLlmShim({
    store,
    config: fakeTelnyxShimConfig(),
    agentTurn,
    localeFor,
    voiceControl,
    watchdog,
  });
  return { call, voiceControl, timers, clock, watchdog, handler };
}

test("T12: Dead-Air kappt nicht waehrend der Sprechdauer - vertagt sich einmalig (Spec-Verifikation 1)", async () => {
  const { call, voiceControl, timers, clock, handler } = setupSpeechTurn(LONG_SPEECH);

  await handler(validReq(call, { messages: [{ role: "user", content: SUBSTANTIAL_TEXT }] }), fakeRes());
  assert.deepEqual(timers.pendingDelays(), [DEAD_AIR_TEST_MS], "der Turn armiert die Standard-Frist wie im Bestand");

  clock.advance(DEAD_AIR_TEST_MS);
  const lines = await captureConsole(() => {
    timers.fireAll();
    return Promise.resolve();
  });

  assert.equal(
    voiceControl.calls.filter((c) => c.op === "hangup").length,
    0,
    "kein Hangup waehrend der geschaetzten Sprechdauer",
  );
  assert.deepEqual(
    timers.pendingDelays(),
    [LONG_SPEECH_MS], // Rest 35500 (65500 - 30000) + Frist 30000
    "Vertagung deckt Rest der Sprechdauer plus die volle Frist",
  );
  assert.ok(
    lines.some(
      (l) => l.startsWith(WATCHDOG_LOG_PREFIX) && l.includes("speech_extend") && l.includes('"speechExtendedMs":65500'),
    ),
    "speech_extend-Log fehlt",
  );
  assert.ok(
    !lines.some((l) => l.includes("dead_air")),
    "kein dead_air-Log, solange die Sprech-Verlaengerung aktiv ist (Abnahmekriterium)",
  );
});

test("T13: nach Ablauf der Sprech-Verlaengerung terminiert der Watchdog genau einmal (Rueckversicherung, Verifikation 2)", async () => {
  const { call, voiceControl, timers, clock, handler } = setupSpeechTurn(LONG_SPEECH);

  await handler(validReq(call, { messages: [{ role: "user", content: SUBSTANTIAL_TEXT }] }), fakeRes());
  clock.advance(DEAD_AIR_TEST_MS);
  await captureConsole(() => {
    timers.fireAll();
    return Promise.resolve();
  });

  clock.advance(LONG_SPEECH_MS);
  const lines = await captureConsole(() => {
    timers.fireAll();
    return Promise.resolve();
  });

  assert.equal(voiceControl.calls.filter((c) => c.op === "hangup").length, 1, "genau ein Hangup nach der Vertagung");
  assert.ok(
    lines.some(
      (l) =>
        l.startsWith(WATCHDOG_LOG_PREFIX) &&
        l.includes("dead_air") &&
        l.includes('"turnSeq":1') &&
        l.includes('"speechExtendedMs":65500'),
    ),
    "dead_air-Log nach der Vertagung fehlt oder traegt die falschen Felder",
  );

  timers.fireAll(); // nichts mehr pending -> No-op
  assert.equal(voiceControl.calls.filter((c) => c.op === "hangup").length, 1, "kein zweiter (spurioser) Hangup");
});

test("T14: kein Aufaddieren ueber Turns (Verifikation 3 / Auflage 4) - der Zeitstempel wird ersetzt, nicht summiert", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const voiceControl = fakeVoiceControl();
  const timers = fakeTimers();
  const clock = fakeClock();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers, now: clock.now });

  watchdog.arm(call.id);
  watchdog.observeTurn(call.id, SUBSTANTIAL_TEXT);
  watchdog.noteAgentSpeech(call.id, { speechChars: 1000, language: "de" });

  clock.advance(10_000);
  watchdog.observeTurn(call.id, SUBSTANTIAL_TEXT);
  watchdog.noteAgentSpeech(call.id, { speechChars: 1000, language: "de" });

  clock.advance(30_000);
  timers.fireAll();

  assert.deepEqual(
    timers.pendingDelays(),
    [LONG_SPEECH_MS], // NICHT 131000 - der zweite Turn ERSETZT den Zeitstempel des ersten
    "zwei Turns duerfen sich nicht aufaddieren",
  );

  clock.advance(LONG_SPEECH_MS);
  timers.fireAll();
  assert.equal(voiceControl.calls.filter((c) => c.op === "hangup").length, 1, "genau ein Hangup, kein Leck");
});

test("T15: kurze Antwort ist byte-identisch zum Bestand (Verifikation 4, strukturell statt praktisch)", async () => {
  const { call, voiceControl, timers, clock, handler } = setupSpeechTurn("Hallo Welt");

  await handler(validReq(call, { messages: [{ role: "user", content: SUBSTANTIAL_TEXT }] }), fakeRes());
  assert.deepEqual(timers.pendingDelays(), [DEAD_AIR_TEST_MS], "keine zusaetzliche Timer-Stellung durch noteAgentSpeech");

  clock.advance(DEAD_AIR_TEST_MS);
  const lines = await captureConsole(() => {
    timers.fireAll();
    return Promise.resolve();
  });

  assert.equal(voiceControl.calls.filter((c) => c.op === "hangup").length, 1, "eine laengst fertige Antwort terminiert wie im Bestand");
  assert.ok(
    lines.some((l) => l.startsWith(WATCHDOG_LOG_PREFIX) && l.includes("dead_air") && l.includes('"speechExtendedMs":0')),
    "dead_air-Log fehlt oder speechExtendedMs ist nicht 0",
  );
  assert.ok(!lines.some((l) => l.includes("speech_extend")), "keine speech_extend-Zeile fuer eine kurze Antwort");
});

test("T16: der Deckel der Sprech-Verlaengerung greift (Auflage 3, Grenzfall)", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const voiceControl = fakeVoiceControl();
  const timers = fakeTimers();
  const clock = fakeClock();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers, now: clock.now });

  watchdog.arm(call.id);
  watchdog.noteAgentSpeech(call.id, { speechChars: 100_000, language: "de" });

  clock.advance(DEAD_AIR_TEST_MS);
  timers.fireAll();

  assert.deepEqual(
    timers.pendingDelays(),
    [SPEECH_EXTENSION_MAX_MS_EXPECTED], // Rest 60000 + Frist 30000, gedeckelt auf 90000
    "die Vertagung darf den Deckel nicht ueberschreiten",
  );
});

test("T17: kein Text -> keine Verlaengerung (Grenzfall 0/leer)", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const voiceControl = fakeVoiceControl();
  const timers = fakeTimers();
  const clock = fakeClock();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers, now: clock.now });

  watchdog.arm(call.id);
  watchdog.noteAgentSpeech(call.id, { speechChars: 0, language: "de" });
  watchdog.noteAgentSpeech(call.id);

  clock.advance(DEAD_AIR_TEST_MS);
  const lines = await captureConsole(() => {
    timers.fireAll();
    return Promise.resolve();
  });

  assert.equal(voiceControl.calls.filter((c) => c.op === "hangup").length, 1, "terminiert sofort wie im Bestand");
  assert.ok(
    lines.some((l) => l.startsWith(WATCHDOG_LOG_PREFIX) && l.includes("dead_air") && l.includes('"speechExtendedMs":0')),
  );
});

// T18 (Review-Fund Runde 1, dead-air-speech): T16 kappte "zufaellig" bei exakt
// SPEECH_EXTENSION_MAX_MS, weil arm() und noteAgentSpeech() dort auf DERSELBEN Uhrzeit
// liefen (keine Turn-Latenz) - remainingSpeechMs+deadAirMs ergibt in diesem Sonderfall
// IMMER genau spokenMs, unabhaengig von einer Klammerung. Dieser Test legt echte
// Turn-Latenz zwischen die Dead-Air-Armierung (observeTurn-Zeitpunkt) und noteAgentSpeech
// (Ende von agentTurn()) - genau die Luecke, die der Review fand: ohne Math.min in
// extendForSpeech waere die Vertagung um die Latenz LAENGER als der dokumentierte Deckel.
test("T18: der Deckel der Sprech-Verlaengerung greift AUCH bei Turn-Latenz zwischen Armierung und Sprech-Schaetzung", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const voiceControl = fakeVoiceControl();
  const timers = fakeTimers();
  const clock = fakeClock();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers, now: clock.now });

  // T0: observeTurn/arm stellt den Dead-Air-Timer auf T0+DEAD_AIR_TEST_MS (30000).
  watchdog.arm(call.id);

  // Turn-Latenz L=25000ms bis agentTurn() fertig ist - NOCH vor dem Feuern des Timers
  // (25000 < 30000), aber nahe genug daran, dass die Luecke sichtbar wird.
  const TURN_LATENCY_MS = 25_000;
  clock.advance(TURN_LATENCY_MS);
  // noteAgentSpeech setzt speechEndsAtMs relativ zu SEINEM (spaeteren) now(): 25000+65500.
  watchdog.noteAgentSpeech(call.id, { speechChars: 1000, language: "de" }); // LONG_SPEECH_MS=65500

  // Der Timer feuert planmaessig bei T0+30000.
  clock.advance(DEAD_AIR_TEST_MS - TURN_LATENCY_MS);
  const lines = await captureConsole(() => {
    timers.fireAll();
    return Promise.resolve();
  });

  // OHNE Klammerung waere extendedMs 90500 (remainingSpeechMs 60500 + deadAirMs 30000) -
  // 500ms UEBER dem dokumentierten Deckel. Mit dem Fix bleibt es bei genau 90000.
  assert.deepEqual(
    timers.pendingDelays(),
    [90_000],
    "die Vertagung darf den Deckel auch bei Turn-Latenz nicht ueberschreiten",
  );
  assert.ok(
    lines.some(
      (l) => l.startsWith(WATCHDOG_LOG_PREFIX) && l.includes("speech_extend") && l.includes('"speechExtendedMs":90000'),
    ),
    "speech_extend-Log muss den geklammerten Wert tragen, nicht den unklammerten 90500",
  );
});

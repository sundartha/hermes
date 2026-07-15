// Unit-Tests fuer die Call-Control-Zustandsmaschine (PLAN-TELNYX-AI-ASSISTANT.md, P4.5):
// makeCallControlIngest mit injizierten Fakes/Spies (kein Netz, kein Server-Spawn,
// F.I.R.S.T.). Deckt Checks 4/5/6 aus tasks/telnyx-p4_5-spec.md: Reihenfolge
// (answered->speak, NIE startAssistant vorher; speak.ended->startAssistant), Disclosure-
// Text-Bindung, Idempotenz-Beitrag der Maschine (zweites hangup -> kein zweites
// endCallRecord), unbekannter callId/Event -> keine Wirkung, kein Crash. Muster fuer
// Fake-Store/Spies vgl. telnyx-llm-shim.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallControlIngest } from "../src/telnyx-call-control-ingest.js";
import { captureConsole, noopWatchdog, makeConfigOverrides } from "./helpers.js";
import { config } from "../src/config.js";
import { fakeTimers } from "./telnyx-shim-harness.js";

// afix-p1: config.telnyxElevenLabs fuer die Dauer eines Tests setzen/restaurieren -
// deterministisch statt env-abhaengig (eine lokale .env darf die Observability-Tests nicht
// beeinflussen). Gemeinsame Implementierung mit telnyx-call-control.test.js in
// test/helpers.js (G5, Review-Blocker Runde 2) statt eigener fast wortgleicher Kopie.
const { withConfig } = makeConfigOverrides(config);
function withElevenLabsConfig(value, fn) {
  return withConfig("telnyxElevenLabs", value, fn);
}
const FULL_ELEVENLABS_CONFIG = { voiceId: "voice_el_123", apiKeyRef: "elevenlabs_prod", model: "eleven_flash_v2_5" };
const EMPTY_ELEVENLABS_CONFIG = { voiceId: "", apiKeyRef: "", model: "Default" };

// stab-p9: Pflicht-Dependency der Zustandsmaschine (arm/clear werden jetzt aus onSpeakEnded/
// onHangup gerufen); diese Suite prueft die Kosten-Notaus-Achse selbst NICHT (das deckt
// test/telnyx-stab-p9-watchdog.test.js gegen die ECHTEN Module ab) - EIN No-op-Spy statt
// 16x wortgleicher Inline-Definition (G5).
const NOOP_WATCHDOG = noopWatchdog();

// afix-timeout: die drei neuen Ingest-Deps fuer answered-Bestandstests, die den Opening-Speak-
// Timeout nicht selbst pruefen. Bundelt config (echter Singleton) + frischen Fake-Timer je
// Aufruf -> verhindert einen echten unref-Timer-Leak (P12 Repeatable), ohne dass der Test die
// Timer inspizieren muss. Die Timeout-Logik selbst hat eigene Tests unten (fireAll/pendingCount).
function ingestTimeoutDeps() {
  const t = fakeTimers();
  return { config, setTimer: t.setTimer, clearTimer: t.clearTimer };
}

// Fake-Store: haelt GENAU einen Call (oder keinen), zeichnet markAnswered/endCallRecord
// auf und spiegelt deren Effekt auf das Fixture-Objekt (wie state-ops.js: dieselbe
// Referenz wird mutiert, store.getCall liefert danach den mutierten Stand).
function fakeStore(call) {
  const markAnsweredCalls = [];
  const endCallRecordCalls = [];
  return {
    markAnsweredCalls,
    endCallRecordCalls,
    getCall(id) {
      return call && call.id === id ? call : null;
    },
    markAnswered(id) {
      markAnsweredCalls.push(id);
    },
    endCallRecord(id, status) {
      endCallRecordCalls.push({ id, status });
      if (call && call.id === id) call.status = status;
    },
  };
}

// stab-p10: Spiegel kennt den Call zunaechst NICHT (Instanzwechsel); reattachActiveCall
// "laedt" ihn nach - modelliert den Deploy-Instanzwechsel-Rehydrate-Pfad exakt, ohne
// echten Store. getCall bleibt bis zum Nachladen ein Miss (call.id !== known.id).
function fakeStoreRehydrate(call) {
  let known = null;
  const endCallRecordCalls = [];
  const markAnsweredCalls = [];
  const store = {
    endCallRecordCalls,
    markAnsweredCalls,
    getCall: (id) => (known && known.id === id ? known : null),
    markAnswered: (id) => markAnsweredCalls.push(id),
    endCallRecord: (id, status) => {
      endCallRecordCalls.push({ id, status });
      if (known?.id === id) known.status = status;
    },
  };
  const reattachActiveCall = async (id) => {
    if (id !== call.id) return { call: null, logUnknown: true };
    known = call; // Instanzwechsel-Rehydrate: der Call landet jetzt im Spiegel
    return { call, logUnknown: false };
  };
  return { store, reattachActiveCall };
}

function fakeRes() {
  return {
    statusSent: null,
    sendStatus(code) {
      this.statusSent = code;
      return this;
    },
  };
}

// Spy-VoiceControl: zeichnet speak/startAssistant-Aufrufe auf, ignoriert den provider-
// Parameter nicht (Assert im Aufrufer moeglich), liefert resolvte No-ops. failSpeak
// (afix-p1, optional): Praedikat ueber den speak-Params-Aufruf - true wirft NACH dem
// Aufzeichnen (Fallback-Kette b/c/d testbar, Default: nie).
function fakeVoiceControl({ failSpeak } = {}) {
  const speakCalls = [];
  const startAssistantCalls = [];
  const providerCalls = [];
  const voiceControl = (provider) => {
    providerCalls.push(provider);
    return {
      async speak(p) {
        speakCalls.push(p);
        if (failSpeak && failSpeak(p)) throw new Error("speak fehlgeschlagen (Test)");
      },
      async startAssistant(p) {
        startAssistantCalls.push(p);
      },
    };
  };
  return { voiceControl, speakCalls, startAssistantCalls, providerCalls };
}

function answeredBody(callControlId) {
  return { data: { event_type: "call.answered", payload: { call_control_id: callControlId } } };
}
function speakEndedBody(callControlId) {
  return { data: { event_type: "call.speak.ended", payload: { call_control_id: callControlId } } };
}
function speakFailedBody(callControlId) {
  return { data: { event_type: "call.speak.ended", payload: { call_control_id: callControlId, status: "failed" } } };
}
function hangupBody(callControlId) {
  return { data: { event_type: "call.hangup", payload: { call_control_id: callControlId } } };
}

const OPENING_TEXT = "Guten Tag, hier spricht der KI-Assistent von Jonas Beispiel. Es geht um Folgendes: Testanliegen.";

test("answered: Opening-Speak gefeuert (Text=openingText, voiceProfile aus localeFor), startAssistant NICHT (Reihenfolge), markAnswered gerufen", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const finishCallCalls = [];
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async (c) => finishCallCalls.push(c),
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
    ...ingestTimeoutDeps(),
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_1" }, body: answeredBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.deepEqual(vc.providerCalls, ["telnyx"]);
  assert.equal(vc.speakCalls.length, 1);
  assert.deepEqual(vc.speakCalls[0], {
    callControlId: "cc_1",
    text: OPENING_TEXT,
    voiceProfile: "de_female_neural",
    useAssistantVoice: true,
  });
  assert.equal(vc.startAssistantCalls.length, 0, "ai_assistant_start NIE auf answered direkt");
  assert.deepEqual(store.markAnsweredCalls, ["call_1"]);
  assert.equal(finishCallCalls.length, 0);
});

// ---- afix-p1: Fallback-Kette (a-d) + Retry-State-Cleanup + Observability ----

// T-neu 5 (Fallback b): der Opening-Speak mit der Assistant-Stimme wirft synchron (z.B.
// HTTP 400) -> genau EIN Retry mit der Bestands-Stimme, kein startAssistant, kein Crash.
// Config MUSS gesetzt sein (withElevenLabsConfig): sonst hat der erste Versuch mangels
// Config bereits Azure gesprochen (kein "Assistant-Stimme ist gescheitert"-Fall, Review-
// Blocker Runde 3 (d) - siehe die eigenen "Config fehlt"-Tests weiter unten).
test("afix-p1 (b): Opening-Speak mit Assistant-Stimme wirft -> genau ein Retry mit useAssistantVoice=false", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl({ failSpeak: (p) => p.useAssistantVoice === true });
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
    ...ingestTimeoutDeps(),
  });
  await withElevenLabsConfig(FULL_ELEVENLABS_CONFIG, async () => {
    const res = fakeRes();
    await handler({ query: { callId: "call_1" }, body: answeredBody("cc_1") }, res);

    assert.equal(res.statusSent, 200);
    assert.equal(vc.speakCalls.length, 2);
    assert.equal(vc.speakCalls[0].useAssistantVoice, true);
    assert.equal(vc.speakCalls[1].useAssistantVoice, false);
    assert.equal(vc.startAssistantCalls.length, 0);
  });
});

// T-neu 6 (b+d): auch der Azure-Retry scheitert -> Token bereits verbraucht, kein dritter
// Speak-Versuch, kein startAssistant, kein Crash (der Handler-Catch faengt den durchgereichten Fehler).
test("afix-p1 (b+d): auch der Retry mit der Bestands-Stimme scheitert -> kein dritter Speak-Versuch, kein Crash", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl({ failSpeak: () => true });
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
    ...ingestTimeoutDeps(),
  });
  await withElevenLabsConfig(FULL_ELEVENLABS_CONFIG, async () => {
    const res = fakeRes();
    await handler({ query: { callId: "call_1" }, body: answeredBody("cc_1") }, res);

    assert.equal(res.statusSent, 200, "200 ist bereits vor dem Fehler raus");
    assert.equal(vc.speakCalls.length, 2, "kein dritter Speak-Versuch (Retry-Token verbraucht)");
    assert.equal(vc.startAssistantCalls.length, 0);
  });
});

// T-neu 7 (c): die Offenlegung scheitert per Event (call.speak.ended status=failed) -> genau
// EIN Retry mit der Bestands-Stimme; ein ZWEITES speak.failed loest keinen weiteren Retry
// mehr aus (Token verbraucht) -> Fail-Safe-Log "kein Assistant-Start".
test("afix-p1 (c): speak.failed-Event -> genau ein Retry; zweites speak.failed -> Fail-Safe ohne weiteren Retry", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });

  await withElevenLabsConfig(FULL_ELEVENLABS_CONFIG, async () => {
    await handler({ query: { callId: "call_1" }, body: speakFailedBody("cc_1") }, fakeRes());
    assert.equal(vc.speakCalls.length, 1);
    assert.equal(vc.speakCalls[0].useAssistantVoice, false);
    assert.equal(vc.startAssistantCalls.length, 0);

    const lines = await captureConsole(() =>
      handler({ query: { callId: "call_1" }, body: speakFailedBody("cc_1") }, fakeRes()),
    );
    assert.equal(vc.speakCalls.length, 1, "kein weiterer Retry (Token bereits verbraucht)");
    assert.equal(vc.startAssistantCalls.length, 0);
    assert.ok(lines.some((l) => l.includes("kein Assistant-Start")), "Fail-Safe-Log fehlt");
  });
});

// T-neu 8 (c->ended): nach dem Retry per speak.failed feuert ein nachfolgendes speak.ended
// weiterhin genau EINEN startAssistant (Reihenfolge/Fail-Safe unveraendert).
test("afix-p1 (c->ended): Retry per speak.failed, danach speak.ended -> genau ein startAssistant", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });

  await withElevenLabsConfig(FULL_ELEVENLABS_CONFIG, async () => {
    await handler({ query: { callId: "call_1" }, body: speakFailedBody("cc_1") }, fakeRes());
    await handler({ query: { callId: "call_1" }, body: speakEndedBody("cc_1") }, fakeRes());

    assert.equal(vc.startAssistantCalls.length, 1);
    assert.deepEqual(vc.startAssistantCalls[0], { callControlId: "cc_1", assistantId: "asst_77", language: "de" });
  });
});

// T-neu 9 (State-Cleanup): onHangup raeumt den Retry-Merker - ein verbrauchtes Token wird
// nach hangup wieder frei (naechster Call/derselbe Call-Slot bekommt sein eigenes Retry).
test("afix-p1: onHangup raeumt das Retry-Token - danach ist wieder genau ein Retry moeglich", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });

  await withElevenLabsConfig(FULL_ELEVENLABS_CONFIG, async () => {
    await handler({ query: { callId: "call_1" }, body: speakFailedBody("cc_1") }, fakeRes());
    assert.equal(vc.speakCalls.length, 1, "erster Retry verbraucht");

    await handler({ query: { callId: "call_1" }, body: hangupBody("cc_1") }, fakeRes());
    await handler({ query: { callId: "call_1" }, body: speakFailedBody("cc_1") }, fakeRes());

    assert.equal(vc.speakCalls.length, 2, "nach hangup wieder ein frisches Retry-Token");
  });
});

// ---- Review-Blocker Runde 3 (d): Config-Aus MUSS byte-identisch zum Bestand bleiben ----
// Der Ingest reicht useAssistantVoice:true immer durch; OHNE ElevenLabs-Config faellt der
// Adapter intern bereits auf Azure zurueck (speakVoiceFields). Ein Speak-Fehler DANACH darf
// deshalb KEIN Retry mehr verbrauchen - sonst spraeche ein zweiter, redundanter Azure-Versuch,
// den es vor afix-p1 nie gab (Spec (a): "Config unvollstaendig -> direkt Azure, kein Retry").

// Sync-Pfad (onAnswered-Catch): der (Azure-)Speak wirft synchron (z.B. Netzfehler) OHNE
// Config -> kein Retry, der Fehler wird unveraendert an den Handler-Catch durchgereicht
// (identisch zum Verhalten VOR afix-p1: ein einziger Speak-Versuch, kein zweiter).
test("afix-p1 (d, Blocker Runde 3): Config fehlt UND Opening-Speak wirft synchron -> KEIN Retry (byte-identisch zum Bestand)", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl({ failSpeak: () => true });
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
    ...ingestTimeoutDeps(),
  });

  await withElevenLabsConfig(EMPTY_ELEVENLABS_CONFIG, async () => {
    const res = fakeRes();
    await handler({ query: { callId: "call_1" }, body: answeredBody("cc_1") }, res);

    assert.equal(res.statusSent, 200, "200 ist bereits vor dem Fehler raus");
    assert.equal(vc.speakCalls.length, 1, "genau EIN Speak-Versuch - kein Retry ohne Config");
    assert.equal(vc.startAssistantCalls.length, 0);
  });
});

// Event-Pfad (onSpeakFailed): call.speak.failed OHNE Config -> kein Retry, direkt der
// heutige Fail-Safe-Log ("kein Assistant-Start"), kein zweiter Speak-Versuch.
test("afix-p1 (d, Blocker Runde 3): Config fehlt UND speak.failed-Event -> KEIN Retry, sofort Fail-Safe (byte-identisch zum Bestand)", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });

  await withElevenLabsConfig(EMPTY_ELEVENLABS_CONFIG, async () => {
    const lines = await captureConsole(() =>
      handler({ query: { callId: "call_1" }, body: speakFailedBody("cc_1") }, fakeRes()),
    );
    assert.equal(vc.speakCalls.length, 0, "kein Retry-Speak ohne Config");
    assert.equal(vc.startAssistantCalls.length, 0);
    assert.ok(lines.some((l) => l.includes("kein Assistant-Start")), "Fail-Safe-Log fehlt");
  });
});

// T-neu 10 (Observability): opening_voice-Marker fuer alle drei Zweige - elevenlabs (volle
// Config), azure reason=config_missing (leere Config, useAssistantVoice=true) und azure
// reason=retry_after_failure (Retry-Pfad). Keine Zeile traegt die ccid oder einen Secret-Wert.
test("afix-p1 (Observability): opening_voice-Marker fuer elevenlabs/config_missing/retry_after_failure, ohne ccid/Secret-Leak", async () => {
  const callOk = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const storeOk = fakeStore(callOk);
  const vcOk = fakeVoiceControl();
  const handlerOk = makeCallControlIngest({
    store: storeOk,
    voiceControl: vcOk.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
    ...ingestTimeoutDeps(),
  });
  await withElevenLabsConfig(FULL_ELEVENLABS_CONFIG, async () => {
    const lines = await captureConsole(() =>
      handlerOk({ query: { callId: "call_1" }, body: answeredBody("cc_secret_1") }, fakeRes()),
    );
    assert.ok(lines.some((l) => l.includes("opening_voice=elevenlabs (call=call_1)")));
    assert.ok(!lines.some((l) => l.includes("cc_secret_1")), "kein ccid-Leak");
    assert.ok(!lines.some((l) => l.includes(FULL_ELEVENLABS_CONFIG.apiKeyRef)), "kein Secret-Ref-Leak");
  });

  const callMissing = { id: "call_2", status: "active", provider: "telnyx", language: "de" };
  const storeMissing = fakeStore(callMissing);
  const vcMissing = fakeVoiceControl();
  const handlerMissing = makeCallControlIngest({
    store: storeMissing,
    voiceControl: vcMissing.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
    ...ingestTimeoutDeps(),
  });
  await withElevenLabsConfig(EMPTY_ELEVENLABS_CONFIG, async () => {
    const lines = await captureConsole(() =>
      handlerMissing({ query: { callId: "call_2" }, body: answeredBody("cc_2") }, fakeRes()),
    );
    assert.ok(lines.some((l) => l.includes("opening_voice=azure reason=config_missing (call=call_2)")));
  });

  const callRetry = { id: "call_3", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const storeRetry = fakeStore(callRetry);
  const vcRetry = fakeVoiceControl();
  const handlerRetry = makeCallControlIngest({
    store: storeRetry,
    voiceControl: vcRetry.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });
  // Retry braucht volle Config (Review-Blocker Runde 3 (d)): ohne Config gaetet
  // consumeOpeningRetry auf false, der Retry-Pfad wuerde nie erreicht.
  await withElevenLabsConfig(FULL_ELEVENLABS_CONFIG, async () => {
    const retryLines = await captureConsole(() =>
      handlerRetry({ query: { callId: "call_3" }, body: speakFailedBody("cc_3") }, fakeRes()),
    );
    assert.ok(retryLines.some((l) => l.includes("opening_voice=azure reason=retry_after_failure (call=call_3)")));
  });
});

test("speak.ended MIT call.assistantId -> startAssistant gefeuert mit callControlId+assistantId", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_1" }, body: speakEndedBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(vc.speakCalls.length, 0, "speak.ended loest kein erneutes Speak aus");
  assert.equal(vc.startAssistantCalls.length, 1);
  assert.deepEqual(vc.startAssistantCalls[0], { callControlId: "cc_1", assistantId: "asst_77", language: "de" });
});

// afix-p2 (P2-T6): zweiter Sprachwert (fr, NICHT de wie die anderen Fixtures) beweist den
// Durchreiche-Pfad call.language -> Port - ein einzelner de-Fixture koennte auch eine
// Hardcodierung passieren lassen (RCA-Lehre "gleiche Fixture-Werte testen nichts").
test("speak.ended MIT call.language=fr -> startAssistant traegt language=fr", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "fr", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "fr_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_1" }, body: speakEndedBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(vc.startAssistantCalls.length, 1);
  assert.equal(vc.startAssistantCalls[0].language, "fr");
});

test("speak.ended OHNE call.assistantId -> fail-safe skip, kein startAssistant, kein Crash", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" }; // keine assistantId
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_1" }, body: speakEndedBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(vc.startAssistantCalls.length, 0);
});

// Regressionstest (Regel 2): eine fehlgeschlagene Offenlegung (Azure-NTTS-Stoerung,
// payload.status="failed") darf ai_assistant_start NIE ausloesen - selbst wenn
// call.assistantId GESETZT ist. Ohne diesen Fix haette die Zustandsmaschine hier
// startAssistant gefeuert, obwohl die Pflicht-Offenlegung nie zu hoeren war.
test("speak.ended MIT status='failed' UND gesetzter assistantId -> startAssistant bleibt aus (fail-safe skip)", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_1" }, body: speakFailedBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(vc.startAssistantCalls.length, 0, "kein Assistant-Start ohne gehoerte Offenlegung");
});

test("hangup: finishCall gerufen, endCallRecord nur bei status active; zweites hangup NICHT erneut endCallRecord (Idempotenz-Beitrag der Maschine)", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const finishCallCalls = [];
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async (c) => finishCallCalls.push(c),
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });

  const res1 = fakeRes();
  await handler({ query: { callId: "call_1" }, body: hangupBody("cc_1") }, res1);
  assert.equal(res1.statusSent, 200);
  assert.equal(store.endCallRecordCalls.length, 1);
  assert.deepEqual(store.endCallRecordCalls[0], { id: "call_1", status: "completed" });
  assert.equal(finishCallCalls.length, 1);
  assert.equal(finishCallCalls[0], call, "finishCall bekommt die frisch geholte Call-Referenz");
  assert.equal(call.status, "completed", "Maschine flippt den Status VOR finishCall (Muster /voice/status)");

  const res2 = fakeRes();
  await handler({ query: { callId: "call_1" }, body: hangupBody("cc_1") }, res2);
  assert.equal(res2.statusSent, 200);
  assert.equal(store.endCallRecordCalls.length, 1, "kein zweites endCallRecord (status nicht mehr active)");
  assert.equal(finishCallCalls.length, 2, "finishCall wird erneut gerufen, dessen EIGENE billedAt-Idempotenz greift (route-Test)");
});

test("unbekannter callId -> 200 ohne Wirkung, kein Crash", async () => {
  const store = fakeStore(null);
  const vc = fakeVoiceControl();
  const finishCallCalls = [];
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async (c) => finishCallCalls.push(c),
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
    reattachActiveCall: async () => ({ call: null, logUnknown: true }),
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_unknown" }, body: hangupBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(vc.speakCalls.length, 0);
  assert.equal(vc.startAssistantCalls.length, 0);
  assert.equal(finishCallCalls.length, 0);
  assert.equal(store.endCallRecordCalls.length, 0);
});

test("unbekanntes Event (z.B. call.speak.started) -> 200 ohne Wirkung, kein Crash", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const finishCallCalls = [];
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async (c) => finishCallCalls.push(c),
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });
  const res = fakeRes();
  const body = { data: { event_type: "call.speak.started", payload: { call_control_id: "cc_1" } } };
  await handler({ query: { callId: "call_1" }, body }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(vc.speakCalls.length, 0);
  assert.equal(vc.startAssistantCalls.length, 0);
  assert.equal(finishCallCalls.length, 0);
});

// OBS-2 Test 1 (DoD-Kern, Anti-Klemme): call.speak.ended mit status="succeeded" (NICHT
// "completed") klassifiziert trotzdem zu SPEAK_ENDED (siehe call-control-events.js: der
// Status wird fuer die Ended-Klassifikation nicht geprueft) und feuert startAssistant. Der
// Roh-Log darf den echten Status NICHT auf eine completed/failed-Allowlist klemmen - sonst
// verschluckt die Beobachtung genau den Token, den P1a-FIX braucht.
test("OBS-2: call.speak.ended mit status=succeeded -> Roh-Log zeigt event_type+status UNGEKLEMMT", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });
  const body = {
    data: { event_type: "call.speak.ended", payload: { call_control_id: "cc_1", status: "succeeded" } },
  };
  const lines = await captureConsole(() => handler({ query: { callId: "call_1" }, body }, fakeRes()));

  assert.equal(vc.startAssistantCalls.length, 1, "SPEAK_ENDED klassifiziert trotz Nicht-completed-Status");
  const rawLine = lines.find((l) => l.includes("event empfangen"));
  assert.ok(rawLine, "Roh-Log-Zeile fehlt");
  assert.match(rawLine, /event_type=call\.speak\.ended/);
  assert.match(rawLine, /status=succeeded/);
});

// OBS-2 Test 2: unbekanntes Event (call.playback.ended) -> Roh-Log zeigt den echten
// event_type+status, keine Aktion wird ausgeloest (byte-identisches Klassifikationsverhalten).
test("OBS-2: unbekanntes Event call.playback.ended -> Roh-Log zeigt Token, keine Aktion", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });
  const body = {
    data: { event_type: "call.playback.ended", payload: { call_control_id: "cc_1", status: "finished" } },
  };
  const lines = await captureConsole(() => handler({ query: { callId: "call_1" }, body }, fakeRes()));

  assert.equal(vc.speakCalls.length, 0);
  assert.equal(vc.startAssistantCalls.length, 0);
  const rawLine = lines.find((l) => l.includes("event empfangen"));
  assert.ok(rawLine, "Roh-Log-Zeile fehlt");
  assert.match(rawLine, /event_type=call\.playback\.ended/);
  assert.match(rawLine, /status=finished/);
});

// OBS-2 Test 3 (unknown_call, PII): der rohe (Caller-kontrollierte) Query-Wert darf NIE
// im Log landen (Regel 4) - nur der Grund-Token. Genau eine Zeile (kein zusaetzlicher
// Roh-Log, da der Dispatch bei unbekanntem callId vorher returnt).
test("OBS-2: unbekannter callId -> Log traegt reason=unknown_call, NIE den rohen Query-Wert", async () => {
  const store = fakeStore(null);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
    reattachActiveCall: async () => ({ call: null, logUnknown: true }),
  });
  const leakyCallId = "callId_leaky_9999";
  const lines = await captureConsole(() =>
    handler({ query: { callId: leakyCallId }, body: hangupBody("cc_1") }, fakeRes()),
  );

  assert.equal(lines.length, 1, "genau eine Log-Zeile bei unbekanntem callId");
  assert.match(lines[0], /reason=unknown_call/);
  assert.ok(!lines[0].includes(leakyCallId), "roher Query-Wert darf NICHT im Log stehen");
});

// OBS-2 Test 4 (Kette + PII): answered -> speak.ended -> hangup erzeugt drei Erfolgs-Logs
// mit der internen call.id; die ccid ("cc_secret") darf in KEINER Ingest-Log-Zeile stehen
// (Regel 4 - Ingest-Logs tragen call.id, nicht die ccid).
test("OBS-2: answered->speak.ended->hangup -> drei Erfolgs-Logs, ccid-Wert nirgends geloggt", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
    ...ingestTimeoutDeps(),
  });
  const ccid = "cc_secret";
  const lines = await captureConsole(async () => {
    await handler({ query: { callId: "call_1" }, body: answeredBody(ccid) }, fakeRes());
    await handler({ query: { callId: "call_1" }, body: speakEndedBody(ccid) }, fakeRes());
    await handler({ query: { callId: "call_1" }, body: hangupBody(ccid) }, fakeRes());
  });

  assert.ok(lines.some((l) => l.includes("answered (call=call_1) -> Opening-Speak")));
  assert.ok(lines.some((l) => l.includes("speak.ended (call=call_1) -> ai_assistant_start")));
  assert.ok(lines.some((l) => l.includes("hangup (call=call_1) -> Settlement")));
  assert.ok(!lines.some((l) => l.includes(ccid)), "ccid-Wert darf in keiner Ingest-Log-Zeile stehen");
});

// Review-Blocker Runde 2 (T1/T5, rawToken): Event-Body OHNE data.event_type (env=null,
// eventEnvelope liefert null wenn event_type fehlt) -> logEventReceived darf nicht crashen
// und muss beide Token als "none" loggen (null/undefined-Zweig von rawToken).
test("Review-Blocker: Event-Body ohne data.event_type -> Roh-Log zeigt event_type=none status=none", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });
  const body = { data: { payload: { call_control_id: "cc_1" } } }; // kein event_type
  const lines = await captureConsole(() => handler({ query: { callId: "call_1" }, body }, fakeRes()));

  assert.equal(vc.speakCalls.length, 0);
  assert.equal(vc.startAssistantCalls.length, 0);
  const rawLine = lines.find((l) => l.includes("event empfangen"));
  assert.ok(rawLine, "Roh-Log-Zeile fehlt");
  assert.match(rawLine, /event_type=none status=none/);
});

// Review-Blocker Runde 2 (T1/T5, rawToken): event_type/status laenger als EVENT_TOKEN_MAX_LEN
// (64) -> Log-Zeile ist bei 64 Zeichen gekappt (Trunkierungs-Zweig von rawToken).
test("Review-Blocker: event_type/status ueber 64 Zeichen -> Roh-Log-Token bei 64 Zeichen gekappt", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });
  const longEventType = "call.speak.ended" + "x".repeat(64); // 80 Zeichen, kein Mapping-Treffer
  const longStatus = "y".repeat(80); // 80 Zeichen
  const body = { data: { event_type: longEventType, payload: { call_control_id: "cc_1", status: longStatus } } };
  const lines = await captureConsole(() => handler({ query: { callId: "call_1" }, body }, fakeRes()));

  assert.equal(vc.speakCalls.length, 0);
  assert.equal(vc.startAssistantCalls.length, 0);
  const rawLine = lines.find((l) => l.includes("event empfangen"));
  assert.ok(rawLine, "Roh-Log-Zeile fehlt");
  assert.ok(rawLine.includes(`event_type=${longEventType.slice(0, 64)} `), "event_type-Token nicht bei 64 gekappt");
  assert.ok(rawLine.endsWith(`status=${longStatus.slice(0, 64)}`), "status-Token nicht bei 64 gekappt");
  assert.ok(!rawLine.includes(longEventType), "event_type darf nicht ungekuerzt im Log stehen");
  assert.ok(!rawLine.includes(longStatus), "status darf nicht ungekuerzt im Log stehen");
});

// stab-p10 (A6 Baustein 1): hangup nach Deploy-/Instanzwechsel. Der Prozess-Spiegel kennt
// den Call nicht (getCall-Miss), reattachActiveCall laedt ihn nach - Settlement (finishCall)
// laeuft trotzdem, statt das Live-Gespraech zu verwerfen (Reserve-Leak/gesperrtes Budget).
test("stab-p10: hangup nach Instanzwechsel - getCall-Miss -> reattachActiveCall laedt -> Settlement laeuft", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const { store, reattachActiveCall } = fakeStoreRehydrate(call);
  const vc = fakeVoiceControl();
  const finishCallCalls = [];
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async (c) => finishCallCalls.push(c),
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
    reattachActiveCall,
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_1" }, body: hangupBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(store.endCallRecordCalls.length, 1);
  assert.deepEqual(store.endCallRecordCalls[0], { id: "call_1", status: "completed" });
  assert.equal(finishCallCalls.length, 1, "Settlement laeuft trotz getCall-Miss");
  assert.equal(finishCallCalls[0], call, "finishCall bekommt den nachgeladenen Call");
});

// stab-p10 (A6 Baustein 1): answered nach Instanzwechsel - der Turn-Fluss (Opening-Speak)
// laeuft auf dem nachgeladenen Call unveraendert weiter.
test("stab-p10: answered nach Instanzwechsel - Opening-Speak auf dem nachgeladenen Call", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const { store, reattachActiveCall } = fakeStoreRehydrate(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
    reattachActiveCall,
    ...ingestTimeoutDeps(),
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_1" }, body: answeredBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(vc.speakCalls.length, 1);
  assert.deepEqual(vc.speakCalls[0], {
    callControlId: "cc_1",
    text: OPENING_TEXT,
    voiceProfile: "de_female_neural",
    useAssistantVoice: true,
  });
  assert.deepEqual(store.markAnsweredCalls, ["call_1"]);
});

// stab-p10 (A6 Baustein 1, Regel 4/OBS-2-Paritaet): reattachActiveCall selbst liefert einen
// echten Miss (Ueber-Zeit-Leg bereits terminalisiert ODER wirklich unbekannt) -> 200 ohne
// Wirkung, genau eine reason=unknown_call-Zeile, NIE der rohe Query-Wert.
test("stab-p10: Rehydrate-Miss (reattachActiveCall -> call:null) -> 200, keine Wirkung, genau eine unknown_call-Zeile", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const { reattachActiveCall } = fakeStoreRehydrate(call); // call.id passt NIE zur angefragten callId
  const store = fakeStore(null); // Spiegel selbst kennt ebenfalls nichts
  const vc = fakeVoiceControl();
  const finishCallCalls = [];
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async (c) => finishCallCalls.push(c),
    openingText: () => OPENING_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
    reattachActiveCall,
  });
  const leakyCallId = "callId_leaky_9999";
  const lines = await captureConsole(() =>
    handler({ query: { callId: leakyCallId }, body: hangupBody("cc_1") }, fakeRes()),
  );

  assert.equal(vc.speakCalls.length, 0);
  assert.equal(vc.startAssistantCalls.length, 0);
  assert.equal(finishCallCalls.length, 0);
  assert.equal(lines.length, 1, "genau eine Log-Zeile bei Rehydrate-Miss");
  assert.match(lines[0], /reason=unknown_call/);
  assert.ok(!lines[0].includes(leakyCallId), "roher Query-Wert darf NICHT im Log stehen");
});

// ---- afix-timeout (Befund 2): Opening-Speak-Timeout-Guard ----

test("afix-timeout: answered armiert genau EINEN Opening-Speak-Timer (Delay = config.telnyxOpeningSpeakTimeoutS*1000)", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const timers = fakeTimers();
  const handler = makeCallControlIngest({
    store, voiceControl: vc.voiceControl, finishCall: async () => {},
    openingText: () => OPENING_TEXT, localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG, config, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  await handler({ query: { callId: "call_1" }, body: answeredBody("cc_1") }, fakeRes());
  assert.equal(timers.pendingCount(), 1, "genau ein Opening-Speak-Timer nach answered");
  // Delay aus derselben config gelesen (drift-fest, RCA-Lehre "gleiche Fixture-Werte testen nichts").
  assert.deepEqual(timers.pendingDelays(), [config.telnyxOpeningSpeakTimeoutS * 1000]);
});

test("afix-timeout: kein speak.ended/failed -> Timer feuert -> genau EIN Azure-Retry (wie onSpeakFailed)", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const timers = fakeTimers();
  const handler = makeCallControlIngest({
    store, voiceControl: vc.voiceControl, finishCall: async () => {},
    openingText: () => OPENING_TEXT, localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG, config, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  await withElevenLabsConfig(FULL_ELEVENLABS_CONFIG, async () => {
    await handler({ query: { callId: "call_1" }, body: answeredBody("cc_1") }, fakeRes());
    assert.equal(vc.speakCalls.length, 1, "nur der Opening-Speak, noch kein Retry");
    timers.fireAll();
    await new Promise((r) => setImmediate(r)); // onSpeakFailed-Kette drainen
    assert.equal(vc.speakCalls.length, 2, "Timeout loest genau EINEN Azure-Retry aus");
    assert.equal(vc.speakCalls[1].useAssistantVoice, false, "Retry mit Bestands-Stimme");
    assert.equal(vc.startAssistantCalls.length, 0, "kein Assistant-Start (Offenlegung nicht bestaetigt)");
    // Review-Blocker Runde 1: der Retry-Leg armiert einen NEUEN Watchdog (statt ungeschuetzt zu
    // haengen) - der alte Erst-Timer ist geraeumt, aber genau ein frischer Retry-Timer laeuft.
    assert.equal(timers.pendingCount(), 1, "Retry-Leg armiert einen neuen Watchdog-Timer (kein Leak, kein ungeschuetzter Retry)");
  });
});

// Review-Blocker Runde 1 (S1, Korrektheit): der Retry-Leg des Timeout-Watchdogs armiert VOR
// diesem Fix KEINEN neuen Timer - genau das Symptom, das afix-timeout beheben soll (Telnyx'
// Speak-Command verstummt OHNE Terminal-Event), kann identisch auf dem Retry-Leg auftreten.
// Dieser Test beweist das erneute Armieren (pendingCount()===1 NACH dem Retry-Speak).
test("afix-timeout (Review-Blocker Runde 1): Retry-Leg armiert erneut einen Watchdog-Timer", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const timers = fakeTimers();
  const handler = makeCallControlIngest({
    store, voiceControl: vc.voiceControl, finishCall: async () => {},
    openingText: () => OPENING_TEXT, localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG, config, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  await withElevenLabsConfig(FULL_ELEVENLABS_CONFIG, async () => {
    await handler({ query: { callId: "call_1" }, body: answeredBody("cc_1") }, fakeRes());
    assert.equal(timers.pendingCount(), 1, "Erst-Speak-Watchdog armiert");

    timers.fireAll(); // Erst-Timeout -> onSpeakFailed -> Azure-Retry
    await new Promise((r) => setImmediate(r));

    assert.equal(vc.speakCalls.length, 2, "Azure-Retry abgesetzt");
    assert.equal(timers.pendingCount(), 1, "Retry-Leg hat einen NEUEN Watchdog-Timer armiert (kein ungeschuetzter Retry)");
  });
});

// Fortsetzung: feuert auch dieser zweite Watchdog (Retry verstummt identisch zum Erstversuch),
// ist das Retry-Token bereits verbraucht -> Fail-Safe, KEIN dritter Speak-Versuch, KEIN
// Endlos-Retry, und kein herrenloser Timer (kein Leak).
test("afix-timeout (Review-Blocker Runde 1): Retry-Watchdog feuert erneut -> Fail-Safe statt Endlos-Retry", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const timers = fakeTimers();
  const handler = makeCallControlIngest({
    store, voiceControl: vc.voiceControl, finishCall: async () => {},
    openingText: () => OPENING_TEXT, localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG, config, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  await withElevenLabsConfig(FULL_ELEVENLABS_CONFIG, async () => {
    await handler({ query: { callId: "call_1" }, body: answeredBody("cc_1") }, fakeRes());
    timers.fireAll(); // Erst-Timeout -> Azure-Retry + neuer Watchdog
    await new Promise((r) => setImmediate(r));
    assert.equal(vc.speakCalls.length, 2);

    const lines = await captureConsole(async () => {
      timers.fireAll(); // Retry-Watchdog feuert - Retry-Token bereits verbraucht
      await new Promise((r) => setImmediate(r));
    });

    assert.equal(vc.speakCalls.length, 2, "kein dritter Speak-Versuch - Retry-Token verbraucht");
    assert.equal(vc.startAssistantCalls.length, 0, "kein Assistant-Start ohne bestaetigte Offenlegung");
    assert.equal(timers.pendingCount(), 0, "kein weiterer Timer nach dem terminalen Fail-Safe (kein Leak)");
    assert.ok(lines.some((l) => l.includes("kein Assistant-Start")), "Fail-Safe-Log fehlt");
  });
});

test("afix-timeout: Timer feuert OHNE Assistant-Config -> Fail-Safe (kein Retry, kein Assistant-Start)", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const timers = fakeTimers();
  const handler = makeCallControlIngest({
    store, voiceControl: vc.voiceControl, finishCall: async () => {},
    openingText: () => OPENING_TEXT, localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG, config, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  await withElevenLabsConfig(EMPTY_ELEVENLABS_CONFIG, async () => {
    await handler({ query: { callId: "call_1" }, body: answeredBody("cc_1") }, fakeRes());
    assert.equal(vc.speakCalls.length, 1, "Opening-Speak (Azure via Config-Fallback)");
    const lines = await captureConsole(async () => {
      timers.fireAll();
      await new Promise((r) => setImmediate(r));
    });
    assert.equal(vc.speakCalls.length, 1, "kein Retry ohne freie Assistant-Config (byte-identisch onSpeakFailed)");
    assert.equal(vc.startAssistantCalls.length, 0);
    assert.ok(lines.some((l) => l.includes("kein Assistant-Start")), "Fail-Safe-Log fehlt");
  });
});

test("afix-timeout: speak.ended VOR Timeout -> Timer geloescht, spaeteres fireAll loest nichts aus", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const timers = fakeTimers();
  const handler = makeCallControlIngest({
    store, voiceControl: vc.voiceControl, finishCall: async () => {},
    openingText: () => OPENING_TEXT, localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG, config, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  await handler({ query: { callId: "call_1" }, body: answeredBody("cc_1") }, fakeRes());
  assert.equal(timers.pendingCount(), 1);
  await handler({ query: { callId: "call_1" }, body: speakEndedBody("cc_1") }, fakeRes());
  assert.equal(timers.pendingCount(), 0, "speak.ended hat den Opening-Speak-Timer geloescht");
  assert.equal(vc.startAssistantCalls.length, 1, "regulaerer Assistant-Start");
  const before = vc.speakCalls.length;
  timers.fireAll();
  await new Promise((r) => setImmediate(r));
  assert.equal(vc.speakCalls.length, before, "kein spaeter Fehlalarm nach echtem speak.ended");
});

test("afix-timeout: hangup VOR Timeout -> Timer geloescht, kein Aufruf nach Call-Ende", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const timers = fakeTimers();
  const handler = makeCallControlIngest({
    store, voiceControl: vc.voiceControl, finishCall: async () => {},
    openingText: () => OPENING_TEXT, localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG, config, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  await handler({ query: { callId: "call_1" }, body: answeredBody("cc_1") }, fakeRes());
  assert.equal(timers.pendingCount(), 1);
  await handler({ query: { callId: "call_1" }, body: hangupBody("cc_1") }, fakeRes());
  assert.equal(timers.pendingCount(), 0, "hangup hat den Opening-Speak-Timer geloescht");
  const before = vc.speakCalls.length;
  timers.fireAll();
  await new Promise((r) => setImmediate(r));
  assert.equal(vc.speakCalls.length, before, "kein Speak nach Call-Ende");
});

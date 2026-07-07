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
// Parameter nicht (Assert im Aufrufer moeglich), liefert resolvte No-ops.
function fakeVoiceControl() {
  const speakCalls = [];
  const startAssistantCalls = [];
  const providerCalls = [];
  const voiceControl = (provider) => {
    providerCalls.push(provider);
    return {
      async speak(p) {
        speakCalls.push(p);
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
function hangupBody(callControlId) {
  return { data: { event_type: "call.hangup", payload: { call_control_id: callControlId } } };
}

const DISCLOSURE_TEXT = "Guten Tag, hier spricht der KI-Assistent von Jonas Beispiel.";

test("answered: Disclosure-Speak gefeuert (Text=disclosureSentence, voiceProfile aus localeFor), startAssistant NICHT (Reihenfolge), markAnswered gerufen", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const finishCallCalls = [];
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async (c) => finishCallCalls.push(c),
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_1" }, body: answeredBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.deepEqual(vc.providerCalls, ["telnyx"]);
  assert.equal(vc.speakCalls.length, 1);
  assert.deepEqual(vc.speakCalls[0], {
    callControlId: "cc_1",
    text: DISCLOSURE_TEXT,
    voiceProfile: "de_female_neural",
  });
  assert.equal(vc.startAssistantCalls.length, 0, "ai_assistant_start NIE auf answered direkt");
  assert.deepEqual(store.markAnsweredCalls, ["call_1"]);
  assert.equal(finishCallCalls.length, 0);
});

test("speak.ended MIT call.assistantId -> startAssistant gefeuert mit callControlId+assistantId", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_1" }, body: speakEndedBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(vc.speakCalls.length, 0, "speak.ended loest kein erneutes Speak aus");
  assert.equal(vc.startAssistantCalls.length, 1);
  assert.deepEqual(vc.startAssistantCalls[0], { callControlId: "cc_1", assistantId: "asst_77" });
});

test("speak.ended OHNE call.assistantId -> fail-safe skip, kein startAssistant, kein Crash", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" }; // keine assistantId
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_1" }, body: speakEndedBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(vc.startAssistantCalls.length, 0);
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
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
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
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
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
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
  });
  const res = fakeRes();
  const body = { data: { event_type: "call.speak.started", payload: { call_control_id: "cc_1" } } };
  await handler({ query: { callId: "call_1" }, body }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(vc.speakCalls.length, 0);
  assert.equal(vc.startAssistantCalls.length, 0);
  assert.equal(finishCallCalls.length, 0);
});

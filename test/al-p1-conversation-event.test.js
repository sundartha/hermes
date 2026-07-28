// AL-P1 (Latenz-Achse): call.conversation.created - rein diagnostischer Zweig (kein
// Call-Effekt, kein Gate). Muster test/telnyx-event-ingest-parser.test.js (parseCallControlEvent
// pure) + test/telnyx-event-ingest-machine.test.js (Fake-Store/-VoiceControl-Spies).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCallControlEvent,
  conversationIdFrom,
  CALL_CONTROL_EVENT,
} from "../src/telephony/adapters/telnyx/call-control-events.js";
import { makeCallControlIngest } from "../src/telnyx-call-control-ingest.js";
import { captureConsole, noopWatchdog } from "./helpers.js";
import { ingestTimeoutDeps } from "./telnyx-shim-harness.js";

// AL-P1-10: call.conversation.created -> CONVERSATION_CREATED (deepEqual-Shape unveraendert -
// dieselben zwei Felder wie jeder andere Event-Typ dieses Moduls).
test("AL-P1-10: call.conversation.created -> CONVERSATION_CREATED + callControlId", () => {
  const body = {
    data: {
      event_type: "call.conversation.created",
      payload: { call_control_id: "cc_conv_1", conversation_id: "conv_abc" },
    },
  };
  assert.deepEqual(parseCallControlEvent(body), {
    eventType: CALL_CONTROL_EVENT.CONVERSATION_CREATED,
    callControlId: "cc_conv_1",
  });
});

// AL-P1-11: conversationIdFrom liefert die UUID; fehlend/leer/nicht-String -> null.
test("AL-P1-11: conversationIdFrom liefert die UUID aus payload.conversation_id", () => {
  const body = { data: { event_type: "call.conversation.created", payload: { conversation_id: "conv_xyz" } } };
  assert.equal(conversationIdFrom(body), "conv_xyz");
});

test("AL-P1-11b: conversationIdFrom -> null bei fehlendem/leerem/nicht-String conversation_id", () => {
  assert.equal(conversationIdFrom({ data: { event_type: "x", payload: {} } }), null, "fehlendes Feld");
  assert.equal(
    conversationIdFrom({ data: { event_type: "x", payload: { conversation_id: "" } } }),
    null,
    "leerer String",
  );
  assert.equal(
    conversationIdFrom({ data: { event_type: "x", payload: { conversation_id: 123 } } }),
    null,
    "nicht-String",
  );
  assert.equal(conversationIdFrom(null), null, "Garbage-Body");
  assert.equal(conversationIdFrom({}), null, "leerer Body");
});

// ---- Ingest-Zweig: Store-Write + selbstmeldender Miss-Log (2.6/2.7 der Spec) ----

function fakeStore(call) {
  const recordTelnyxConversationIdCalls = [];
  return {
    recordTelnyxConversationIdCalls,
    getCall(id) {
      return call && call.id === id ? call : null;
    },
    recordTelnyxConversationId(id, conversationId) {
      recordTelnyxConversationIdCalls.push({ id, conversationId });
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

// Spy-VoiceControl: zaehlt speak/startAssistant-Aufrufe (Negativ-Beweis fuer AL-P1-13).
function fakeVoiceControl() {
  const speakCalls = [];
  const startAssistantCalls = [];
  function voiceControl() {
    return {
      speak: async (p) => speakCalls.push(p),
      startAssistant: async (p) => startAssistantCalls.push(p),
    };
  }
  voiceControl.speakCalls = speakCalls;
  voiceControl.startAssistantCalls = startAssistantCalls;
  return voiceControl;
}

function conversationCreatedBody(callControlId, conversationId) {
  const payload = { call_control_id: callControlId };
  if (conversationId !== undefined) payload.conversation_id = conversationId;
  return { data: { event_type: "call.conversation.created", payload } };
}

function buildHandler({ store, voiceControl }) {
  return makeCallControlIngest({
    store,
    voiceControl,
    finishCall: async () => {},
    openingText: () => "Opening",
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: noopWatchdog(),
    ...ingestTimeoutDeps(),
  });
}

test("AL-P1-12: Ingest speichert die UUID am Call (Hit-Fall, UUID nicht im Log)", async () => {
  const call = { id: "call_conv_hit", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = buildHandler({ store, voiceControl: vc });
  const res = fakeRes();

  const lines = await captureConsole(() =>
    handler({ query: { callId: call.id }, body: conversationCreatedBody("cc_hit", "conv_secret_uuid") }, res),
  );

  assert.equal(res.statusSent, 200);
  assert.deepEqual(store.recordTelnyxConversationIdCalls, [{ id: call.id, conversationId: "conv_secret_uuid" }]);
  const okLine = lines.find((l) => l.includes("conversation_created") && l.includes("UUID gespeichert"));
  assert.ok(okLine, "Erfolgs-Log muss geschrieben werden");
  assert.ok(!okLine.includes("conv_secret_uuid"), "der UUID-WERT darf nie im Log stehen (nur Praesenz)");
});

test("AL-P1-12b: Ingest meldet den Miss keys-only, wenn conversation_id fehlt", async () => {
  const call = { id: "call_conv_miss", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = buildHandler({ store, voiceControl: vc });
  const res = fakeRes();

  // conversation_id absichtlich weggelassen, dafuer ein anderer Feldname im payload -
  // genau das ist der Fall, den der Miss-Zweig gegen einen kuenftigen Feldnamen-Fehler absichert.
  const body = {
    data: {
      event_type: "call.conversation.created",
      payload: { call_control_id: "cc_miss", conversation_uuid: "conv_should_be_seen_as_key_only" },
    },
  };

  const lines = await captureConsole(() => handler({ query: { callId: call.id }, body }, res));

  assert.equal(res.statusSent, 200);
  assert.deepEqual(store.recordTelnyxConversationIdCalls, [], "kein Store-Write ohne conversation_id");
  const missLine = lines.find((l) => l.includes("OHNE conversation_id"));
  assert.ok(missLine, "Miss-Log muss geschrieben werden");
  assert.ok(missLine.includes("payload_keys="), "Miss-Log traegt die keys-only Payload-Liste");
  assert.ok(missLine.includes("conversation_uuid"), "der tatsaechliche FeldNAME muss sichtbar sein");
  assert.ok(missLine.includes("call_control_id"), "alle Payload-Feldnamen erscheinen (keys-only)");
  assert.ok(
    !missLine.includes("conv_should_be_seen_as_key_only"),
    "kein Feld-WERT darf im Miss-Log erscheinen (nur Schluessel)",
  );
});

test("AL-P1-13: conversation.created loest weder speak noch startAssistant noch Settlement aus", async () => {
  const call = { id: "call_conv_inert", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = buildHandler({ store, voiceControl: vc });
  const res = fakeRes();

  await captureConsole(() =>
    handler({ query: { callId: call.id }, body: conversationCreatedBody("cc_inert", "conv_inert_uuid") }, res),
  );

  assert.equal(res.statusSent, 200);
  assert.equal(vc.speakCalls.length, 0, "kein Opening-Speak durch conversation.created");
  assert.equal(vc.startAssistantCalls.length, 0, "kein ai_assistant_start durch conversation.created");
  assert.equal(call.status, "active", "der Call bleibt aktiv - kein Settlement ausgeloest");
});

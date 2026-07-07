// Pure-Unit-Tests fuer parseCallControlEvent (Telnyx-Call-Control-Lifecycle-Klassifikation,
// P4.5). KEIN Netz, kein Server-Spawn (F.I.R.S.T.): reine Funktion, reine Eingaben. Muster
// wie telnyx-speak-events.test.js (dieselbe Envelope-Quelle, speak-events.js:eventEnvelope).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCallControlEvent,
  CALL_CONTROL_EVENT,
} from "../src/telephony/adapters/telnyx/call-control-events.js";

test("call.answered -> ANSWERED + callControlId", () => {
  const body = { data: { event_type: "call.answered", payload: { call_control_id: "cc_1" } } };
  assert.deepEqual(parseCallControlEvent(body), {
    eventType: CALL_CONTROL_EVENT.ANSWERED,
    callControlId: "cc_1",
  });
});

test("call.speak.ended -> SPEAK_ENDED + callControlId", () => {
  const body = { data: { event_type: "call.speak.ended", payload: { call_control_id: "cc_2" } } };
  assert.deepEqual(parseCallControlEvent(body), {
    eventType: CALL_CONTROL_EVENT.SPEAK_ENDED,
    callControlId: "cc_2",
  });
});

// Regressionstest: call.speak.ended MIT payload.status="failed" (Azure-NTTS-Stoerung,
// siehe speak-events.js-Header) darf NIE als SPEAK_ENDED gewertet werden, sonst startet
// die Zustandsmaschine ai_assistant_start ohne je gehoerte Pflicht-Offenlegung (Regel 2).
test("call.speak.ended MIT status='failed' -> SPEAK_FAILED, NICHT SPEAK_ENDED", () => {
  const body = {
    data: { event_type: "call.speak.ended", payload: { call_control_id: "cc_2b", status: "failed" } },
  };
  assert.deepEqual(parseCallControlEvent(body), {
    eventType: CALL_CONTROL_EVENT.SPEAK_FAILED,
    callControlId: "cc_2b",
  });
});

test("call.speak.failed (eigener Event-Typ) -> SPEAK_FAILED + callControlId", () => {
  const body = { data: { event_type: "call.speak.failed", payload: { call_control_id: "cc_2c", status: "failed" } } };
  assert.deepEqual(parseCallControlEvent(body), {
    eventType: CALL_CONTROL_EVENT.SPEAK_FAILED,
    callControlId: "cc_2c",
  });
});

test("call.hangup -> HANGUP + callControlId", () => {
  const body = { data: { event_type: "call.hangup", payload: { call_control_id: "cc_3" } } };
  assert.deepEqual(parseCallControlEvent(body), {
    eventType: CALL_CONTROL_EVENT.HANGUP,
    callControlId: "cc_3",
  });
});

test("flache Event-Form (ohne data-Wrapper) wird ebenso erkannt", () => {
  const body = { event_type: "call.answered", payload: { call_control_id: "cc_4" } };
  assert.deepEqual(parseCallControlEvent(body), {
    eventType: CALL_CONTROL_EVENT.ANSWERED,
    callControlId: "cc_4",
  });
});

test("unbekannter event_type -> eventType null, callControlId trotzdem extrahiert", () => {
  const body = { data: { event_type: "call.speak.started", payload: { call_control_id: "cc_5" } } };
  assert.deepEqual(parseCallControlEvent(body), { eventType: null, callControlId: "cc_5" });
});

test("FAIL-SAFE: Garbage/leer/form-encodeter Lifecycle-Body -> beides null, kein Wurf", () => {
  for (const body of [null, undefined, {}, "kaputt", { CallStatus: "completed" }])
    assert.deepEqual(parseCallControlEvent(body), { eventType: null, callControlId: null });
});

test("fehlende/kaputte call_control_id -> callControlId null (Event trotzdem klassifiziert)", () => {
  const noPayload = { data: { event_type: "call.hangup" } };
  const nonStringId = { data: { event_type: "call.hangup", payload: { call_control_id: 123 } } };
  const emptyId = { data: { event_type: "call.hangup", payload: { call_control_id: "" } } };
  assert.deepEqual(parseCallControlEvent(noPayload), {
    eventType: CALL_CONTROL_EVENT.HANGUP,
    callControlId: null,
  });
  assert.deepEqual(parseCallControlEvent(nonStringId), {
    eventType: CALL_CONTROL_EVENT.HANGUP,
    callControlId: null,
  });
  assert.deepEqual(parseCallControlEvent(emptyId), {
    eventType: CALL_CONTROL_EVENT.HANGUP,
    callControlId: null,
  });
});

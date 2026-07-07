// Telnyx-Adapter: klassifiziert Call-Control-Lifecycle-Webhooks zu einem NEUTRALEN
// Ereignis fuer die event-getriebene Zustandsmaschine (P4.5). Symmetrisch zu
// speak-events.js/parseSpeakEvent + media.js/parseMediaFrame: reine, IO-freie Fn.
// FAIL-SAFE: unbekannte/kaputte Events -> eventType null (Aufrufer ignoriert neutral).
// LIVE UNBESTAETIGT (wie telnyx/voice.js): exakte event_type/payload-Formen mit Owner
// live fixen. Envelope-Abheben UND die Speak-Status-Pruefung aus speak-events.js
// wiederverwendet (G5): call.speak.ended kann bei einer Azure-NTTS-Stoerung mit
// payload.status="failed" kommen (siehe Header dort) - das darf NIE als Erfolg
// (SPEAK_ENDED) durchgereicht werden, sonst startet Regel 2 (Offenlegung) den
// Assistenten, obwohl die Offenlegung nie zu hoeren war.
import { eventEnvelope, parseSpeakEvent, SPEAK_OUTCOME } from "./speak-events.js";

export const CALL_CONTROL_EVENT = Object.freeze({
  ANSWERED: "answered",
  SPEAK_ENDED: "speak_ended",
  SPEAK_FAILED: "speak_failed",
  HANGUP: "hangup",
});

// Roh-Telnyx-event_type -> neutraler Typ. Unbekannt -> undefined (neutral ignoriert).
// call.speak.ended landet hier nur, wenn parseSpeakEvent es NICHT als FAILED einstuft.
const EVENT_TYPE_MAP = Object.freeze({
  "call.answered": CALL_CONTROL_EVENT.ANSWERED,
  "call.speak.ended": CALL_CONTROL_EVENT.SPEAK_ENDED,
  "call.hangup": CALL_CONTROL_EVENT.HANGUP,
});

/**
 * @param {object} body - geparster Webhook-Body ({data:{event_type,payload}} ODER flach)
 * @returns {{eventType: string|null, callControlId: string|null}}
 */
export function parseCallControlEvent(body) {
  const ev = eventEnvelope(body);
  if (!ev) return { eventType: null, callControlId: null };
  // Fehlgeschlagenes Speak hat Vorrang vor der generischen Map (dieselbe Status-Pruefung
  // wie speak-events.js, nicht dupliziert - G5).
  const speak = parseSpeakEvent(body);
  const eventType =
    speak.outcome === SPEAK_OUTCOME.FAILED ? CALL_CONTROL_EVENT.SPEAK_FAILED : EVENT_TYPE_MAP[ev.event_type] || null;
  const payload = ev.payload && typeof ev.payload === "object" ? ev.payload : {};
  const rawId = payload.call_control_id;
  const callControlId = typeof rawId === "string" && rawId ? rawId : null;
  return { eventType, callControlId };
}

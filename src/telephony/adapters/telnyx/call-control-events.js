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
  // AL-P1 (Latenz-Achse): rein diagnostischer Zweig - kein Call-Effekt, kein Gate.
  CONVERSATION_CREATED: "conversation_created",
});

// Roh-Telnyx-event_type -> neutraler Typ. Unbekannt -> undefined (neutral ignoriert).
// call.speak.ended landet hier nur, wenn parseSpeakEvent es NICHT als FAILED einstuft.
const EVENT_TYPE_MAP = Object.freeze({
  "call.answered": CALL_CONTROL_EVENT.ANSWERED,
  "call.speak.ended": CALL_CONTROL_EVENT.SPEAK_ENDED,
  "call.hangup": CALL_CONTROL_EVENT.HANGUP,
  "call.conversation.created": CALL_CONTROL_EVENT.CONVERSATION_CREATED,
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

/**
 * AL-P1: Telnyx' EIGENE Conversation-UUID aus dem call.conversation.created-Payload.
 * LIVE UNBESTAETIGT wie die uebrigen Formen in diesem Modul (Header): der Feldname folgt
 * der in telephony/adapters/telnyx/voice.js gemessenen Konvention (`conversation_id`).
 * Fail-safe null - der Aufrufer loggt den Fehlschlag keys-only, statt still 0 zu messen.
 * @returns {string|null}
 */
export function conversationIdFrom(body) {
  const ev = eventEnvelope(body);
  const raw = ev && ev.payload && typeof ev.payload === "object" ? ev.payload.conversation_id : null;
  return typeof raw === "string" && raw ? raw : null;
}

/**
 * Befund 5 (belegter Defekt: ein unbeantworteter Anruf landet als "completed" ohne
 * lesbaren Grund): Telnyx' Auflege-Diagnosefelder aus dem call.hangup-Payload,
 * STRUKTURIERT statt nur geloggt (Muster conversationIdFrom oben) - der Ingest darf den
 * Status/Grund nicht selbst aus dem Rohbody erraten (Wurzel statt Symptom, CLAUDE.md).
 * hangup_cause treibt die Status-Klassifikation (failure-reason.js: hangupCauseStatus),
 * sip_hangup_cause verfeinert nur den generischen "failed"-Fall (callFailureReason,
 * unveraendert). hangup_source wird bewusst NICHT mitgefuehrt (G12, Nachfassrunde): die
 * Klassifikation (failure-reason.js) braucht nur hangup_cause + answeredAt, ein totes
 * drittes Feld waere Ballast ohne Leser - HANGUP_CAUSE_FIELDS im Ingest loggt es weiterhin
 * roh (eigener, unveraenderter Zweck: Diagnose im Log, keine Status-Entscheidung).
 * Fail-safe null je Feld, kein Wurf.
 * @returns {{hangupCause: string|null, sipHangupCause: string|null}}
 */
export function hangupDiagnosticsFrom(body) {
  const ev = eventEnvelope(body);
  const payload = ev && ev.payload && typeof ev.payload === "object" ? ev.payload : {};
  return {
    hangupCause: typeof payload.hangup_cause === "string" && payload.hangup_cause ? payload.hangup_cause : null,
    sipHangupCause:
      typeof payload.sip_hangup_cause === "string" && payload.sip_hangup_cause ? payload.sip_hangup_cause : null,
  };
}

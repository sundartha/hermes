// Twilio-Adapter Port 5 (WebhookEvents): Twilio-Webhook-Bodies (/voice/turn, /voice/status,
// /voice/speak) -> neutral. VERHALTENS-ERHALTEND aus server.js gezogen (Charakterisierungs-
// Tests pinnen die Ausgabe byte-identisch). Twilio kennt weder Diagnose-Felder noch
// Speak-Command-Events -> diagnostics bleibt leer, parseSpeakOutcome liefert immer NONE.
import { SPEAK_OUTCOME } from "../telnyx/speak-events.js";
import { classifyAnsweredBy } from "../../answered-by.js";

// Erkanntes Speech-Ergebnis aus dem /voice/turn-Body. Twilio sendet `SpeechResult`.
export function parseSpeechResult(body) {
  return (body.SpeechResult || "").trim();
}

// Call-Lifecycle-Status aus dem /voice/status-Body. Twilio sendet keine Diagnose-Felder
// (CallDuration/HangupCause/...) -> diagnostics bleibt leer (byte-identisch zum Bestand).
export function parseLifecycleEvent(body) {
  return { status: body.CallStatus, diagnostics: {} };
}

// Twilio kennt keine server-seitigen Speak-Command-Events -> immer NONE (Hot-Path
// byte-identisch, kein Body-Zugriff noetig).
export function parseSpeakOutcome() {
  return { outcome: SPEAK_OUTCOME.NONE, reason: null };
}

// GAP-21: Ergebnis der Anrufbeantworter-Erkennung aus dem /voice/outbound-Body. Twilio
// liefert `AnsweredBy` (dieselbe Feldform spiegelt TeXML). classifyAnsweredBy ist die
// EINE Klassifikations-Quelle (G5, src/telephony/answered-by.js).
export function parseAnsweredBy(body) {
  return classifyAnsweredBy(body.AnsweredBy);
}

/** @type {import("../../ports.js").WebhookEvents} */
export const twilioWebhookEvents = {
  parseSpeechResult,
  parseLifecycleEvent,
  parseSpeakOutcome,
  parseAnsweredBy,
};

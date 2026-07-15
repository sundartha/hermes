// Twilio-Adapter Port 5 (WebhookEvents): Twilio-Webhook-Bodies (/voice/turn, /voice/status,
// /voice/speak) -> neutral. VERHALTENS-ERHALTEND aus server.js gezogen (Charakterisierungs-
// Tests pinnen die Ausgabe byte-identisch). Twilio kennt weder Diagnose-Felder noch
// Speak-Command-Events -> diagnostics bleibt leer, parseSpeakOutcome liefert immer NONE.
import { SPEAK_OUTCOME } from "../telnyx/speak-events.js";

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

/** @type {import("../../ports.js").WebhookEvents} */
export const twilioWebhookEvents = { parseSpeechResult, parseLifecycleEvent, parseSpeakOutcome };

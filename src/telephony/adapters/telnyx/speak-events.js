// Telnyx-Adapter: klassifiziert Telnyx-"Speak"-Command-Events zu einem NEUTRALEN
// Ergebnis. Eine reine Funktion, die Provider-Events auf neutrale Typen abbildet,
// die der Core (server.js) konsumiert.
//
// HINTERGRUND: Das server-seitige TTS laeuft als TeXML-<Say voice="Azure...Neural">
// (render.js) ueber Telnyx' Azure-NTTS-Backend. Dieses Backend faellt SPORADISCH aus
// ("speak_failed") -> die Pflicht-Offenlegung bzw. die Antwort kommt stumm/abgeschnitten
// an. Telnyx meldet das als Command-Event (call.speak.failed bzw. call.speak.ended mit
// payload.status="failed"). Ein solches Event traegt KEIN CallStatus -> im /voice/status-
// Handler faellt es sonst stumm durch den Lifecycle-Zweig. Genau das ist die Wurzel der
// "intermittent & undiagnosed"-Meldung: die Stoerung ist real, aber unsichtbar.
//
// REIN + IO-frei (unit-testbar, F.I.R.S.T.). FAIL-SAFE: alles, was KEIN erkennbares
// Speak-Event ist (insbesondere der form-encodete CallStatus-Lifecycle-Callback), liefert
// NONE -> der Aufrufer faehrt unveraendert mit dem Lifecycle-Zweig fort (byte-identisch).
// PII-FREI: `reason` ist ein Telnyx-Status-TOKEN aus einer bekannten Allowlist, NIE
// Freitext aus dem Payload -> kein Leak von Namen/Nummern/Gespraechsinhalt ins Log.
//
// LIVE UNBESTAETIGT (wie telnyx/voice.js): die exakten Telnyx-Event-Namen/Payload-Formen
// und ob Telnyx Speak-Command-Events an die TeXML-StatusCallback-URL liefert, sind ohne
// echten Anruf nicht verifiziert. Deshalb defensiv: nur ein EINDEUTIGES Fehlsignal
// (call.speak.failed ODER status="failed") wird als FAILED gewertet (kein Fehlalarm bei
// fehlendem/unbekanntem Status), Unbekanntes -> NONE (nie ein Crash).

// Neutrales Speak-Ergebnis (Enum statt Magic Strings, G25/G16).
export const SPEAK_OUTCOME = Object.freeze({
  NONE: "none", // kein (erkennbares) Speak-Event -> Aufrufer macht unveraendert weiter
  OK: "ok", // Speak erfolgreich abgeschlossen
  FAILED: "failed", // Speak fehlgeschlagen (Azure-NTTS-Stoerung) -> Audio abgeschnitten
});

// PII-freie Allowlist der Telnyx-Speak-Status-Token, die als `reason` ins Log duerfen.
// Alles ausserhalb -> "unknown" (defensiv gegen das Durchreichen von Payload-Freitext).
const KNOWN_REASONS = Object.freeze(["completed", "failed"]);
const REASON_UNKNOWN = "unknown";

// Telnyx-v2 wrappt Events in {data:{event_type,payload}}; manche Pfade liefern flach.
// Hebt die Huelle ab und liefert das Event-Objekt oder null (kein Event erkennbar).
function eventEnvelope(body) {
  if (!body || typeof body !== "object") return null;
  const ev = body.data && typeof body.data === "object" ? body.data : body;
  return ev.event_type ? ev : null;
}

// status auf die PII-freie Allowlist klemmen (nie Payload-Freitext ins Log leaken).
function safeReason(status) {
  return KNOWN_REASONS.includes(status) ? status : REASON_UNKNOWN;
}

/**
 * Klassifiziert einen Telnyx-Webhook-Body zu einem neutralen Speak-Ergebnis.
 * @param {object} body - geparster Webhook-Body (JSON-Command-Event ODER form-encoded
 *                        Lifecycle-Callback; letzterer -> NONE).
 * @returns {{outcome: string, reason: string|null}} reason nur bei FAILED gesetzt.
 */
export function parseSpeakEvent(body) {
  const ev = eventEnvelope(body);
  if (!ev) return { outcome: SPEAK_OUTCOME.NONE, reason: null };
  const status = ev.payload && typeof ev.payload === "object" ? ev.payload.status : undefined;
  // FAILED nur bei EINDEUTIGEM Fehlsignal (kein Fehlalarm bei fehlendem Status).
  if (ev.event_type === "call.speak.failed" || status === "failed")
    return { outcome: SPEAK_OUTCOME.FAILED, reason: safeReason(status || "failed") };
  if (ev.event_type === "call.speak.ended" && status === "completed")
    return { outcome: SPEAK_OUTCOME.OK, reason: safeReason(status) };
  return { outcome: SPEAK_OUTCOME.NONE, reason: null };
}

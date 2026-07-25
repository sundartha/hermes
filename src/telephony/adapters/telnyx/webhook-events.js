// Telnyx-Adapter Port 5 (WebhookEvents): Telnyx-Webhook-Bodies (/voice/turn, /voice/status,
// /voice/speak) -> neutral. VERHALTENS-ERHALTEND aus server.js gezogen (Charakterisierungs-
// Tests pinnen die Ausgabe byte-identisch). SAFE_CAUSE_TOKEN/safeCauseToken UND die
// Diagnose-Logik wandern unveraendert hierher (vorher server.js-lokal). parseSpeakOutcome
// delegiert an parseSpeakEvent (speak-events.js bleibt die EINE Quelle des Enums/der
// Klassifikation, G5 - kein Duplikat; call-control-events.js importiert weiterhin direkt
// von dort, unberuehrt).
import { parseSpeakEvent } from "./speak-events.js";
import { parseAnsweredBy } from "../../answered-by.js";

// Erkanntes Speech-Ergebnis aus dem /voice/turn-Body. Telnyx liefert laut TeXML-Doku
// `Transcript`, real zeigen die Turn-Posts (Live-Beleg 2026-06-20) aber `SpeechResult`
// (und KEIN `Transcript`) - daher defensiv BEIDE lesen (Transcript hat Vorrang), damit
// der Agent den erkannten Text nutzt, egal in welchem Feld Telnyx ihn liefert (sonst
// hoert der Agent trotz korrekter STT nichts -> Stille).
export function parseSpeechResult(body) {
  return (body.Transcript || body.SpeechResult || "").trim();
}

// PII-freie Sanitisierung eines Telnyx-Hangup-Tokens fuers Log (defensiv, analog
// safeReason in speak-events.js). HangupCause ("normal_clearing"), HangupSource
// ("caller"/"callee") und SipHangupCause (SIP-Code, z.B. "486") sind kurze Enums/Codes,
// NIE Telefonnummern/Namen. Trotzdem nie ungefiltert ins Log: nur ein kurzes Token aus
// einer Zeichen-Allowlist (alnum, _ . : -) bis 48 Zeichen wird uebernommen; alles andere
// (Freitext, E.164-Nummern mit "+", zu lang) -> undefined -> kein Diagnose-Feld. BEWUSST
// OHNE Space: Telnyx liefert diese Felder als snake_case-Enum, festes Token oder
// numerischen SIP-Code (nie mit Leerzeichen), also weist die Allowlist Mehrwort-Freitext
// (theoretischer ASCII-Klarname) zusaetzlich ab. So bleibt das Log byte-knapp und PII-frei.
const SAFE_CAUSE_TOKEN = /^[A-Za-z0-9_.:-]{1,48}$/;
function safeCauseToken(value) {
  if (typeof value !== "string") return undefined;
  const token = value.trim();
  return SAFE_CAUSE_TOKEN.test(token) ? token : undefined;
}

// Call-Lifecycle-Status aus dem /voice/status-Body. Telnyx liefert zusaetzlich
// Diagnose-Felder: CallDuration (Sekunden) und beim "Call Completed"-Callback die
// Hangup-Ursache (HangupCause/HangupSource/SipHangupCause - Feldnamen aus der
// Telnyx-OpenAPI-Spec texml/calls.yml, TexmlCallCompletedWebhookSchema). diagnostics
// ist bewusst PII-frei (nur Zahlen + sanitisierte Tokens, NIE From/To/Nummern). Garbage/
// fehlende Felder -> kein Diagnose-Feld (kein NaN, kein leeres/unsauberes Token).
export function parseLifecycleEvent(body) {
  const status = body.CallStatus;
  const durationS = parseInt(body.CallDuration, 10);
  const diagnostics = {};
  if (Number.isFinite(durationS)) diagnostics.callDurationS = durationS;
  const hangupCause = safeCauseToken(body.HangupCause);
  const hangupSource = safeCauseToken(body.HangupSource);
  const sipHangupCause = safeCauseToken(body.SipHangupCause);
  if (hangupCause) diagnostics.hangupCause = hangupCause;
  if (hangupSource) diagnostics.hangupSource = hangupSource;
  if (sipHangupCause) diagnostics.sipHangupCause = sipHangupCause;
  return { status, diagnostics };
}

// Erkennt ein Telnyx-"Speak"-Command-Event (server-seitiges TTS via TeXML-<Say> ueber
// Azure-NTTS) im Webhook-Body. Reine Delegation an parseSpeakEvent - KEINE Logik-Kopie.
export function parseSpeakOutcome(body) {
  return parseSpeakEvent(body);
}

// GAP-21: Ergebnis der Anrufbeantworter-Erkennung aus dem /voice/outbound-Body. Der
// TeXML-Pfad ist Twilio-kompatibel und liefert ebenfalls `AnsweredBy`. Reine Delegation
// an answered-by.js (G5, Review-Fix Runde 2) - KEINE Logik-Kopie, analog parseSpeakOutcome
// oben.
export { parseAnsweredBy };

/** @type {import("../../ports.js").WebhookEvents} */
export const telnyxWebhookEvents = {
  parseSpeechResult,
  parseLifecycleEvent,
  parseSpeakOutcome,
  parseAnsweredBy,
};

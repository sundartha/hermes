// Anrufbeantworter-Klassifikation (GAP-21). Provider-NEUTRAL (die AnsweredBy-Werte sind
// Twilio-Konvention, die Telnyx' TeXML spiegelt) - bewusst nicht im Telnyx-Adapter wie
// SPEAK_OUTCOME, weil beide Adapter denselben Feldnamen lesen und ein Adapter-lokaler
// Enum den Import-Pfeil falsch herum drehen wuerde.

export const ANSWERED_BY = Object.freeze({ MACHINE: "machine", HUMAN: "human", UNKNOWN: "unknown" });

// Eindeutige Maschinen-Ergebnisse. ALLES andere (human, unknown, fehlend, unbekanntes
// Token) -> UNKNOWN und damit fail-open Richtung Gespraech: ein leise oder langsam
// antwortender MENSCH darf nie aufgelegt bekommen (Pre-Mortem 3).
const MACHINE_TOKENS = ["machine_start", "machine_end_beep", "machine_end_silence", "machine_end_other", "fax"];

export function classifyAnsweredBy(raw) {
  if (typeof raw !== "string") return ANSWERED_BY.UNKNOWN;
  if (MACHINE_TOKENS.includes(raw)) return ANSWERED_BY.MACHINE;
  if (raw === "human") return ANSWERED_BY.HUMAN;
  return ANSWERED_BY.UNKNOWN;
}

// GAP-21: Ergebnis der Anrufbeantworter-Erkennung aus dem /voice/outbound-Body. Beide
// Adapter (Twilio + Telnyx/TeXML) liefern denselben Feldnamen `AnsweredBy` - EINE Quelle
// (G5, Review-Fix Runde 2) statt einer byte-identischen Kopie in beiden webhook-events.js.
export function parseAnsweredBy(body) {
  return classifyAnsweredBy(body.AnsweredBy);
}

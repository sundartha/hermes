// AL-P14: der Paraphrase-Riegel. Eine Rueckfrage aus dem laufenden Gespraech verlaesst
// den Server Richtung MCP-Host - der Angerufene hat dem nie zugestimmt. Der Prompt
// verbietet woertliche Zitate, aber ein Prompt ist keine Durchsetzung: hier wird sie
// serverseitig erzwungen. Rein - kein Store, kein config, kein IO (Muster call-result.js).
// AL-P10b: die vier Zitat-Helfer leben seit dem In-Call-Nachschlag in utils/text.js -
// EINE Regel fuer BEIDE Egress-Pfade (MCP-Host hier, Such-Anbieter in
// research/lookup-guard.js). Der Re-Export von VERBATIM_QUOTE_MIN_WORDS haelt die
// Bestands-Importpfade gueltig.
import {
  clampAtWordBoundary,
  containsVerbatimQuote,
  stripQuotedSpans,
  VERBATIM_QUOTE_MIN_WORDS,
} from "../utils/text.js";

export { VERBATIM_QUOTE_MIN_WORDS };

// Obergrenzen der Frage. Benannte Konstanten statt Literale im Rumpf (G25); bewusst NICHT
// konfigurierbar (Muster RESULT_TEXT_MAX_CHARS): eine laengere Frage ist keine
// Betriebsentscheidung, sondern mehr fremde Rede beim Host.
export const CONSULT_QUESTION_MAX_CHARS = 200;

/**
 * Die Frage, wie sie den Server verlassen darf - oder null.
 *
 * null heisst NICHT "Fehler", sondern "diese Frage verlaesst den Server so nicht": der
 * Aufrufer liefert die deterministische Ablehnung an das Modell und laesst das
 * Kontingent unberuehrt. Reihenfolge ist bindend - erst die expliziten Zitate raus,
 * dann gegen die implizite Form pruefen (sonst kaeme ein in Anfuehrungszeichen
 * gesetztes Zitat durch die Zitat-Suche gar nicht mehr an).
 */
export function sanitizeConsultQuestion(question, transcript) {
  if (typeof question !== "string") return null;
  const text = stripQuotedSpans(question).replace(/\s+/g, " ").trim();
  if (containsVerbatimQuote(text, transcript)) return null;
  const clamped = clampAtWordBoundary(text, CONSULT_QUESTION_MAX_CHARS).trim();
  return clamped || null;
}

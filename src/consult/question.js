// AL-P14: der Paraphrase-Riegel. Eine Rueckfrage aus dem laufenden Gespraech verlaesst
// den Server Richtung MCP-Host - der Angerufene hat dem nie zugestimmt. Der Prompt
// verbietet woertliche Zitate, aber ein Prompt ist keine Durchsetzung: hier wird sie
// serverseitig erzwungen. Rein - kein Store, kein config, kein IO (Muster call-result.js).
import { clampAtWordBoundary } from "../utils/text.js";

// Obergrenzen der Frage. Benannte Konstanten statt Literale im Rumpf (G25); bewusst NICHT
// konfigurierbar (Muster RESULT_TEXT_MAX_CHARS): eine laengere Frage ist keine
// Betriebsentscheidung, sondern mehr fremde Rede beim Host.
export const CONSULT_QUESTION_MAX_CHARS = 200;
// Ab wie vielen aufeinanderfolgenden Woertern eine Uebereinstimmung mit dem Transkript als
// woertliches Zitat gilt. Kuerzere Folgen ("koennen Sie mir sagen ob") sind normale
// Sprache und wuerden jede legitime Sachfrage abwuergen.
export const VERBATIM_QUOTE_MIN_WORDS = 6;

// Die EXPLIZITE Zitatform: alles zwischen Anfuehrungszeichen, in allen im Produkt
// vorkommenden Schreibweisen (DE/FR/EN). Erst die Spannen, dann verwaiste Einzelzeichen -
// sonst bliebe bei ungerader Anzahl ein Zitat-Rest stehen.
const QUOTE_CHAR_CLASS = "\"'„“”«»‚‘’";
const QUOTED_SPAN = new RegExp(`[${QUOTE_CHAR_CLASS}][^${QUOTE_CHAR_CLASS}]*[${QUOTE_CHAR_CLASS}]`, "g");
const QUOTE_CHAR = new RegExp(`[${QUOTE_CHAR_CLASS}]`, "g");

function stripQuotedSpans(text) {
  return text.replace(QUOTED_SPAN, " ").replace(QUOTE_CHAR, " ");
}

// Vergleichsform fuer die Zitat-Suche: Kleinschreibung, ohne Satzzeichen, EIN Leerzeichen
// zwischen den Woertern. Ohne sie wuerde schon ein Komma ein woertliches Zitat verstecken.
function comparableWords(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

// Die IMPLIZITE Zitatform: die Frage wiederholt eine lange Wortfolge des Anrufers, ohne
// Anfuehrungszeichen. Verglichen wird gegen die caller-Zeilen des Transkripts - die
// agent-Zeilen sind unsere eigene Rede und duerfen aufgegriffen werden.
function containsVerbatimQuote(text, transcript) {
  const words = comparableWords(text);
  if (words.length < VERBATIM_QUOTE_MIN_WORDS) return false;
  const callerLines = (Array.isArray(transcript) ? transcript : [])
    .filter((entry) => entry?.role === "caller" && typeof entry.text === "string")
    .map((entry) => comparableWords(entry.text).join(" "));
  if (!callerLines.length) return false;
  for (let i = 0; i + VERBATIM_QUOTE_MIN_WORDS <= words.length; i++) {
    const window = words.slice(i, i + VERBATIM_QUOTE_MIN_WORDS).join(" ");
    if (callerLines.some((line) => line.includes(window))) return true;
  }
  return false;
}

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

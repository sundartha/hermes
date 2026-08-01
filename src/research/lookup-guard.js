// Die BEIDEN Riegel des In-Call-Nachschlags (AL-P10b) - eine Datei, ein Grund zur
// Aenderung: was darf RAUS (die Query) und was darf REIN (der Treffer). Rein (N7): kein
// Store, kein config, kein IO (Muster src/consult/question.js / src/call-result.js).
//
// EHRLICHE REICHWEITE (E8): deterministisch durchgesetzt werden Ziffernfolgen,
// E-Mail-Adressen, die Rufnummer des Angerufenen und woertliche Uebernahmen aus dem
// Transkript. KEIN Namens-Filter: call.callerName ist seit G1 (Identitaets-Bindung,
// state-ops.js createCall) hart null - es gibt in diesem Repo keine einzige Zuweisung,
// die es befuellt, ein Filter darauf waere toter Code mit einer falschen
// Schutz-Behauptung. Eine Schlagwortliste fuer "Gesundheit/Finanzen/Personenbezug" wird
// BEWUSST NICHT gebaut: sie waere sprachabhaengig, luecken- und fehlalarm-behaftet und
// wuerde ein Schutzversprechen vortaeuschen. Diese Restflaeche traegt die Tool-Description
// (t.lookUpQueryParam: "ohne Personenbezug", enges Verbot am Entscheidungspunkt, Repo-
// Lehre) - so steht es auch in PLAN-SECURITY.
import { KEY_FACTS_LIMITS, normNum } from "../store/defaults.js";
import { clampAtWordBoundary, containsVerbatimQuote, stripQuotedSpans } from "../utils/text.js";

// Obergrenzen (G25). Bewusst NICHT konfigurierbar (Muster CONSULT_QUESTION_MAX_CHARS):
// eine laengere Query ist keine Betriebsentscheidung, sondern mehr Egress.
export const LOOKUP_QUERY_MAX_CHARS = 120;
export const LOOKUP_MAX_FACTS = 3;

// Ab dieser Laenge ist eine zusammenhaengende Ziffernfolge keine Jahreszahl mehr, sondern
// eine Nummer (Rufnummer, IBAN, Karte, Kundennummer). 4 laesst "2026" durch, 5+ nicht.
const LOOKUP_DIGIT_RUN_MAX = 4;

// Zeichen, die in einer geschriebenen Rufnummer als Trennung vorkommen. Ohne diese
// Reduktion versteckt "0170 123 4567" seine Ziffernfolge vor der Laengenpruefung.
const NUMBER_SEPARATORS = /[\s\-/().]/g;
const NON_DIGITS = /\D+/g;
const DIGIT_RUN = new RegExp(`\\d{${LOOKUP_DIGIT_RUN_MAX + 1},}`);
const EMAIL_LIKE = /[^\s@]+@[^\s@]+/;
// Nicht druckbare Zeichen (Unicode-Kategorie "Other": Control/Format/...) aus fremdem
// Anbieter-Text - ein Zeilenumbruch darin wuerde im HINTERGRUND-Block eine neue
// Prompt-Zeile erzeugen.
const NON_PRINTABLE = /\p{C}/gu;

// Ziffern-NAHE Form: nur die Trennzeichen fallen weg, Buchstaben bleiben stehen. Nur so
// bleibt "oeffnet 2026 um 20 Uhr" harmlos, waehrend "0170 123 4567" zur langen Folge wird.
function withoutNumberSeparators(text) {
  return text.replace(NUMBER_SEPARATORS, "");
}

// Reine Ziffernfolge - die Vergleichsform fuer die Rufnummer des Angerufenen (der
// Vergleich muss ueber Schreibweisen hinweg halten).
function digitsOf(text) {
  return text.replace(NON_DIGITS, "");
}

// Traegt die Query die Rufnummer des Angerufenen? Leere Nummer -> false (ein leerer
// Suchstring waere sonst in JEDER Query enthalten und wuerde alles verwerfen).
function mentionsTarget(text, to) {
  const target = digitsOf(normNum(typeof to === "string" ? to : ""));
  return Boolean(target) && digitsOf(text).includes(target);
}

/**
 * Die Suchanfrage, wie sie den Server verlassen darf - oder null.
 *
 * null heisst NICHT "Fehler", sondern "diese Suche verlaesst den Server NICHT": der
 * Aufrufer liefert die deterministische Ablehnung an das Modell, bucht keine Gebuehr und
 * laesst das Kontingent unberuehrt. Reihenfolge ist bindend - erst die expliziten Zitate
 * raus (sonst kaeme ein in Anfuehrungszeichen gesetztes Zitat durch die Zitat-Suche gar
 * nicht mehr an), dann die Ziel-Pruefung, zuletzt die Kappe.
 */
export function sanitizeLookupQuery(query, call) {
  if (typeof query !== "string") return null;
  const text = stripQuotedSpans(query).replace(/\s+/g, " ").trim();
  if (DIGIT_RUN.test(withoutNumberSeparators(text))) return null;
  if (EMAIL_LIKE.test(text)) return null;
  if (mentionsTarget(text, call?.to)) return null;
  if (containsVerbatimQuote(text, call?.transcript)) return null;
  return clampAtWordBoundary(text, LOOKUP_QUERY_MAX_CHARS).trim() || null;
}

/**
 * Die Treffer, wie sie in den HINTERGRUND duerfen - hoechstens LOOKUP_MAX_FACTS Stueck,
 * je auf die Laenge EINES key_facts-Eintrags gekappt (KEY_FACTS_LIMITS, EINE Quelle mit
 * dem Consult-Merge, G5). Nicht-Array -> []. Rein (N7).
 */
export function lookupFactsFrom(rawFacts) {
  if (!Array.isArray(rawFacts)) return [];
  return rawFacts
    .filter((fact) => typeof fact === "string")
    .map((fact) => fact.replace(NON_PRINTABLE, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, LOOKUP_MAX_FACTS)
    .map((fact) => clampAtWordBoundary(fact, KEY_FACTS_LIMITS.maxLen));
}

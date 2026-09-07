// ---- Die Eroeffnungszeile EINES ElevenLabs-Outbound-Anrufs: PRUEFUNG UND RUECKFALL ----
// (Auftrag 2026-08-19, Thema A.) Anruf 8 hat gemessen, dass der Auftragstext WOERTLICH
// in die erste gesprochene Aeusserung reist ("Termin fuer eine Bremsenpruefung
// vereinbaren" - ASCII-Ersatzschreibung hoerbar am Telefon) und dabei UNGEPRUEFT und
// UNBEGRENZT ist: die first_message ist nicht unterbrechbar, ein 500-Zeichen-Auftrag
// machte die Eroeffnung ueber eine halbe Minute lang.
//
// DIESE DATEI ist die REINE Haelfte: Validierung, Rueckfall-Treppe und die
// Hash-Gegenprobe am Anrufstart. Sie importiert WEDER config NOCH die Store-FASSADE
// (nur reine state-ops) - denn sie haengt am Import-Graphen von
// src/elevenlabs/outbound.js, und die Fassade (src/store.js) bindet beim Import ihr
// Backend samt DATA_DIR. Genau dieser Fruehstart hat beim ersten Zuschnitt dieser
// Datei einen Test auf den falschen Datenpfad gezogen. Die ERZEUGENDE Haelfte
// (Zweit-LLM, Kosten-Buchung) lebt in opening-line-llm.js und wird ausschliesslich
// von routes/api-calls.js geladen - dort haengt die Fassade ohnehin schon am Graphen
// (precall-briefing.js).
//
// FAIL-CLOSED-TREPPE (Auflage A3), nichts Ungeprueftes erreicht je die Sprache:
//   1. erzeugte Zeile (opening-line-llm.js), wenn sie die Pruefung besteht;
//   2. sonst locale.bridgePhrase(objective) - WORTGLEICH die Eroeffnung, die Anruf 8
//      gesprochen hat (49 s, Ziel erreicht) - wenn SIE die Pruefung besteht;
//   3. sonst die feste Kurzzeile der Sprache (locale.openingReasonFallback).
// Auf jeder Stufe wird die Grund-Zeile abschliessend komponiert (composedOpeningLine):
// die feste Frage der Sprache kommt dazu, wenn und nur wenn die Zeile nicht selbst fragt.
// Ein LLM-Ausfall degradiert damit auf den Anruf-8-Wortlaut, SOLANGE der Auftrag die
// Kappe einhaelt (DE: bis ~96 Zeichen). EHRLICH BENANNT (Review-Befund R4): ein
// LAENGERER Auftrag faellt bei totem LLM auf die feste Kurzzeile und verliert damit
// den gesprochenen Anrufgrund - der Preis der harten Kappe (Auflage A2) in Verbindung
// mit "ablehnen statt kuerzen" (Auftrags-Qualitaetsregel 3). Der Hebel dagegen ist
// die Erzeugung (Stufe 1), die lange Auftraege natuerlich verdichtet - sie braucht
// ein gedecktes LLM-Konto.
//
// Die HASH-GEGENPROBE (Auflage A6) haengt am Call-Datensatz: createCall
// (store/state-ops.js) berechnet openingLineSha256 aus der angenommenen Zeile; der
// Anrufstart (outbound.js) nimmt die Zeile nur, wenn der Hash noch stimmt - jede
// Veraenderung zwischen Auftragsannahme und Anruf (Transliteration, Kuerzung,
// Encoding-Unfall, fremder Schreiber) faellt LAUT auf und die Treppe greift ab
// Stufe 2. Umlaute ueberleben, weil zwischen Annahme und Anruf nichts mehr am Text
// dreht - und weil die Erzeugung korrekte Orthografie ausdruecklich verlangt.
import { SUPPORTED_LANGUAGES, disclosurePrefixFor } from "../i18n/locales.js";
import { openingLineHash } from "../store/state-ops.js";

// HARTE LAENGENGRENZE (Auflage A2) fuer die gesprochene Grund-Zeile, in Zeichen.
// 120 Zeichen sind bei gemessenen 17,4 Zeichen/s (Anruf 8) rund 6,9 s Sprechzeit;
// mit Offenlegung (DE 132 Z) und fester Frage (DE 23 Z, seit GQ-E1 ohne Anrede) ist
// die Eroeffnung damit auf ~15,9 s GEDECKELT, und sie faellt weiter, wenn die Zeile
// selbst fragt (dann entfaellt die feste Frage, s. composedOpeningLine) - vorher war
// sie unbegrenzt (TEXT_LIMITS.objective erlaubt 500 Z
// im Auftrag, das waeren ueber 30 s nicht unterbrechbare Eroeffnung). Die Grenze traegt
// auch die Rueckfall-Stufe 2: DE-Bruecke (22 Z) + Auftrag bis ~95 Z + Punkt passt.
export const OPENING_LINE_MAX_CHARS = 120;

// Obergrenze der festen Frage je Sprache. Kein Stilmass, sondern der Deckel der
// Eroeffnung: die gesprochene Zeile ist hoechstens OPENING_LINE_MAX_CHARS + 1 + dieser
// Wert (test/el-opening-line.test.js rechnet das nach). Heutiges Maximum ist EN mit 32.
export const OPENING_QUESTION_MAX_CHARS = 40;

// Zeichen, die in gesprochener Sprache nichts verloren haben: eckige Klammern sind
// die gemessenen Ton-Marken ([thoughtful], ...), geschweifte die Platzhalter-Syntax
// des Anbieters - beides wuerde woertlich vorgelesen bzw. unaufgeloest gesprochen.
const FORBIDDEN_CHARS = /[[\]{}\n\r\t]/;
// Preisangaben (Auflage A4): die Zeile sagt, WORUM es geht, nie zu welchem Preis.
// Deterministisch pruefbar ist nur die bezifferte Form (Zahl+Waehrung bzw.
// Waehrungszeichen+Zahl); semantische Zusagen ohne Zahl haelt die Erzeugungs-
// Anweisung fern, und die Rueckfall-Stufe spricht ohnehin nur den Owner-Auftrag.
const PRICE_PATTERNS = [/\d[\d.,]*\s*(?:€|\$|eur\b|usd\b|euro\b|dollar)/i, /[€$]\s*\d/];
// Satz-Schluss: die Zeile ist EIN fertiger Satz. Ohne Schlusszeichen klebte sie an dem,
// was folgt ("...vereinbaren Wie sieht..."). MIT "?" seit GQ-E1: hinter der Zeile steht
// am Anbieter kein Textteil mehr (der Rahmen endet mit der Variablen, call-locale.js),
// und ob die feste Frage noch dazukommt, entscheidet composedOpeningLine - eine Zeile,
// die selbst fragt, ist damit ein gueltiger Abschluss der Eroeffnung.
const SENTENCE_END = /[.!?]$/;

// Ein Fragezeichen NUR als letztes Zeichen: zwei Fragen in einer Aeusserung lassen den
// Angerufenen raten, welche er beantworten soll. Dieselbe Zusage wie vorher, nur an der
// Stelle, an der sie jetzt etwas entscheidet (composedOpeningLine).
const QUESTION_MARK = "?";
const fragtHoechstensAmEnde = (line) => {
  const i = line.indexOf(QUESTION_MARK);
  return i === -1 || i === line.length - 1;
};

// Der unveraenderliche Kern des Offenlegungssatzes je Sprache, ABGELEITET aus
// LOCALES (kein zweiter Wortlaut, G5): der Satzteil vor dem Namen, ohne die
// Begruessung vor dem ersten Komma. Eine erzeugte Zeile, die ihn wiederholt,
// wird verworfen (Auflage A3) - die Offenlegung steht bereits davor.
const DISCLOSURE_CORES = SUPPORTED_LANGUAGES.map((lang) => {
  // P4a: die Trennung Satz/Name lebt seit hier EINMAL in i18n/locales.js
  // (disclosurePrefixFor) - der Anrufstart-Waechter braucht dieselbe Ableitung.
  const prefix = disclosurePrefixFor(lang);
  return prefix.slice(prefix.indexOf(",") + 1).trim().toLowerCase();
});
// Fail-closed BEIM LADEN (Review-Befund R7): ein leerer Kern - etwa weil eine kuenftige
// Offenlegung mit dem Namen beginnt - machte includes("") wahr und verwuerfe JEDE Zeile
// in JEDER Sprache, still und dauerhaft. Deterministisch beim Laden werfen faellt im
// Test auf, nicht mitten im Anruf (Muster elevenlabs-agent-config.js).
if (DISCLOSURE_CORES.some((core) => core.length === 0)) {
  throw new Error(
    "opening-line.js: ein Offenlegungs-Kern ist leer - die Ableitung aus LOCALES traegt " +
      "fuer mindestens eine Sprache nicht (Name vor dem ersten Komma?). Ableitung " +
      "anpassen, nicht den Waechter entfernen.",
  );
}

/**
 * Prueft EINE Kandidaten-Zeile gegen alle Auflagen. Liefert die getrimmte Zeile
 * oder null - nie eine gekuerzte oder umgeschriebene Fassung (Qualitaetsregel:
 * ablehnen statt still strippen).
 *
 * @param {unknown} candidate
 * @returns {string|null}
 */
export function validOpeningLine(candidate) {
  if (typeof candidate !== "string") return null;
  const line = candidate.trim();
  if (!line || line.length > OPENING_LINE_MAX_CHARS) return null;
  if (FORBIDDEN_CHARS.test(line)) return null;
  if (!SENTENCE_END.test(line)) return null;
  if (!fragtHoechstensAmEnde(line)) return null;
  if (PRICE_PATTERNS.some((pattern) => pattern.test(line))) return null;
  const lower = line.toLowerCase();
  if (DISCLOSURE_CORES.some((core) => lower.includes(core))) return null;
  return line;
}

/**
 * Rueckfall-Stufe 2: der Owner-Auftrag in der Bestands-Bruecke - WORTGLEICH die
 * Eroeffnung von Anruf 8. Whitespace wird wie auf dem Bestandsweg (claude.js
 * trimGoalForSpeech) auf einfache Leerzeichen normalisiert; alles Weitere prueft
 * validOpeningLine, und ein Auftrag, der durchfaellt (zu lang, Klammern, Preis),
 * erreicht die Sprache NICHT (Auflage A5) - dann traegt die feste Kurzzeile.
 *
 * Seit GQ-E1 zwei Formen: ein Auftrag, der auf "?" endet, laeuft OHNE Bruecken-Rahmen
 * durch (er ist bereits die Frage); sonst faellt ein mitgebrachtes [.!] weg, damit
 * bridgePhrase genau ein Satz-Endzeichen setzt.
 *
 * @param {unknown} objective
 * @param {object} locale LOCALES-Bundle (localeFor)
 * @returns {string|null}
 */
export function bridgedObjective(objective, locale) {
  if (typeof objective !== "string") return null;
  const normalized = objective.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  // Der Auftrag IST schon die sprechbare Frage - kein Rahmen, kein zweites Satzzeichen.
  if (normalized.endsWith(QUESTION_MARK)) return validOpeningLine(normalized);
  // Genau EIN Satz-Endzeichen: bridgePhrase setzt ihres, also faellt ein mitgebrachtes
  // vorher weg. BEWUSST NUR [.!] - trimGoalForSpeech (claude.js, Telnyx-Weg) streicht
  // zusaetzlich das Fragezeichen; hier bleibt es stehen, weil eine Frage-Zeile seit
  // dieser Phase gueltig ist. Der Telnyx-Weg bleibt unveraendert.
  const ohneSatzende = normalized.replace(/[.!]+$/, "").trim();
  if (!ohneSatzende) return null;
  return validOpeningLine(locale.bridgePhrase(ohneSatzende));
}

/**
 * Die vollstaendige gesprochene Eroeffnung NACH der Offenlegung: die Grund-Zeile und -
 * nur wenn sie nicht schon selbst fragt - die feste Frage der Sprache. Der statische
 * Rahmen am Anbieter endet mit der Variablen (call-locale.js), also ist DIES der
 * einzige Ort, an dem ueber die Frage entschieden wird. Rein, deterministisch, ohne
 * Sprachkenntnis - in jeder Sprache dieselbe Regel.
 *
 * @param {string} reason gepruefte Grund-Zeile (validOpeningLine)
 * @param {object} locale LOCALES-Bundle (localeFor)
 * @returns {string}
 */
export function composedOpeningLine(reason, locale) {
  return reason.endsWith(QUESTION_MARK) ? reason : `${reason} ${locale.openingQuestion}`;
}

/**
 * Die Zeile, die der Anrufstart WIRKLICH spricht - mit der Hash-Gegenprobe
 * (Auflage A6). Drei Faelle:
 *   - Zeile und Hash stimmen ueberein -> die gespeicherte Zeile;
 *   - beide fehlen (Alt-Datensatz, Engine-Wechsel) -> stiller deterministischer
 *     Rueckfall - fehlend ist kein Angriff;
 *   - alles andere (veraenderte Zeile, halber Datensatz) -> LAUTER Rueckfall.
 * Der Rueckfall ist die Treppe ab Stufe 2 - die veraenderte Zeile selbst wird NIE
 * gesprochen.
 *
 * @param {{call: object, locale: object}} input locale = LOCALES-Bundle (localeFor)
 * @returns {string}
 */
export function verifiedOpeningLine({ call, locale }) {
  const { openingLine, openingLineSha256 } = call;
  if (typeof openingLine === "string" && openingLineSha256 === openingLineHash(openingLine)) {
    return openingLine;
  }
  if (openingLine != null || openingLineSha256 != null) {
    console.warn(
      `[opening-line] veraendert call=${call.id} - gespeicherte Zeile passt nicht ` +
        `zum Annahme-Hash, deterministischer Rueckfall greift`,
    );
  }
  // OBEN VERBUERGT, UNTEN KOMPONIERT: der gespeicherte Wert ist bereits die bei
  // Auftragsannahme komponierte Zeile (fetchOpeningLine, VOR createCall) - der Hash
  // deckt genau ihn ab, deshalb geht er oben byte-genau zurueck. Der Rueckfall
  // entsteht erst hier und muss denselben Kompositionsschritt noch gehen.
  const reason = bridgedObjective(call.goal, locale) ?? locale.openingReasonFallback;
  return composedOpeningLine(reason, locale);
}

// Gemeinsame Lokalisierung fuer ALLE Hermes-Widgets. Der MCP ist international -
// das Widget zeigt seine Oberflaeche in der Sprache des Agenten (seit P13/E4
// SERVERGERENDERT, nicht mehr Browser-Locale), NICHT hart deutsch.
//
// Mechanik (Muster widget-bind.js): dieselben Funktionen laufen in Node-Tests
// UND - via Function.prototype.toString projiziert - als self-contained
// Iframe-Script (I18N_SCRIPT_BY_LOCALE, injiziert von widget-catalog.js in den
// <head> jedes Widgets, VOR den Inline-Skripten -> window.HermesI18n ist dort
// synchron verfuegbar).
//
// Uebersetzungs-Modell: die Keys SIND die englischen Anzeigetexte. Englisch ist
// damit der eingebaute Fallback (kein eigenes en-Dict, kein Key-Drift zwischen
// Markup und Woerterbuch): unbekannter Key oder unbekannte Sprache -> der Key
// selbst wird angezeigt. Die statischen Markup-Texte stehen ebenfalls auf
// Englisch und tragen data-i18n="<derselbe Text>"; faellt das Script aus,
// bleibt die Karte vollstaendig englisch statt kaputt (fail-safe).
// UI-Strings duerfen echte Umlaute/Akzente tragen (UTF-8, meta charset) -
// die ASCII-Disziplin gilt nur fuer Code-Kommentare.

export const DEFAULT_LOCALE = "en";

// Unterstuetzte Nicht-EN-Sprachen = die Produktsprachen der Voice-Seite
// (F1: DE+FR+EN). Neue Sprache = ein neuer Eintrag hier, sonst nichts (OCP);
// der Paritaets-Test (test/mcp-ui-widget-i18n.test.js) erzwingt identische
// Key-Saetze ueber alle Eintraege.
export const WIDGET_DICT = {
  de: {
    "Hermes · Call": "Hermes · Anruf",
    "Hermes · Agent Status": "Hermes · Agent-Status",
    "Hermes · Agent Number": "Hermes · Agent-Nummer",
    "Hermes · Recent Calls": "Hermes · Letzte Anrufe",
    "Hermes · Calendar": "Hermes · Kalender",
    "Your AI phone assistant": "Dein KI-Telefonassistent",
    "Recent calls": "Letzte Anrufe",
    "Calendar": "Kalender",
    "Number": "Nummer",
    "Voice engine": "Voice-Engine",
    "Model": "Modell",
    "Calls": "Anrufe",
    "Monthly usage (%)": "Monatsnutzung (%)",
    "Permissions": "Berechtigungen",
    "Connecting": "Verbindung",
    "Live": "Live",
    "Completed": "Abgeschlossen",
    "Failed": "Fehlgeschlagen",
    "Cancelled": "Abgebrochen",
    "Placing call": "Anruf wird platziert",
    "In call": "Im Gespräch",
    "Call ended": "Anruf beendet",
    "Duration": "Dauer",
    "Reason": "Grund",
    "Result": "Ergebnis",
    "Objective met": "Ziel erreicht",
    "Outcome": "Fazit",
    "Next step": "Nächster Schritt",
    "Cancel call": "Anruf abbrechen",
    "No answer": "Nicht erreicht",
    "Busy": "Besetzt",
    "Yes": "Ja",
    "No": "Nein",
    "Unclear": "Unklar",
  },
  fr: {
    "Hermes · Call": "Hermes · Appel",
    "Hermes · Agent Status": "Hermes · Statut de l'agent",
    "Hermes · Agent Number": "Hermes · Numéro de l'agent",
    "Hermes · Recent Calls": "Hermes · Appels récents",
    "Hermes · Calendar": "Hermes · Calendrier",
    "Your AI phone assistant": "Votre assistant téléphonique IA",
    "Recent calls": "Appels récents",
    "Calendar": "Calendrier",
    "Number": "Numéro",
    "Voice engine": "Moteur vocal",
    "Model": "Modèle",
    "Calls": "Appels",
    "Monthly usage (%)": "Utilisation mensuelle (%)",
    "Permissions": "Autorisations",
    "Connecting": "Connexion",
    "Live": "En direct",
    "Completed": "Terminé",
    "Failed": "Échec",
    "Cancelled": "Annulé",
    "Placing call": "Numérotation en cours",
    "In call": "En communication",
    "Call ended": "Appel terminé",
    "Duration": "Durée",
    "Reason": "Motif",
    "Result": "Résultat",
    "Objective met": "Objectif atteint",
    "Outcome": "Bilan",
    "Next step": "Prochaine étape",
    "Cancel call": "Annuler l'appel",
    "No answer": "Pas de réponse",
    "Busy": "Occupé",
    "Yes": "Oui",
    "No": "Non",
    "Unclear": "Incertain",
  },
};

// Alle Sprachfassungen, die es vom Widget geben kann = die moeglichen Ergebnisse von
// resolveLocale: der eingebaute englische Fallback plus jede Uebersetzungstabelle.
// EINE Quelle fuer die Script- und die HTML-Matrix (widget-catalog.js).
export const WIDGET_LOCALES = Object.freeze([DEFAULT_LOCALE, ...Object.keys(WIDGET_DICT)]);

// "de-DE"/"fr_CH" -> "de"/"fr". Nur der primaere Subtag entscheidet - die
// Widgets haben keine regionalen Varianten.
export function primaryLanguage(tag) {
  return String(tag || "").toLowerCase().split(/[-_]/)[0];
}

// Erster Kandidat (seit P13/E4: die servergerenderte Agentensprache), dessen
// Sprache unterstuetzt wird; nichts passt -> DEFAULT_LOCALE (fail-safe englisch).
export function resolveLocale(candidates, dict) {
  for (const candidate of candidates) {
    const lang = primaryLanguage(candidate);
    if (lang === DEFAULT_LOCALE) return lang;
    if (lang && Object.prototype.hasOwnProperty.call(dict, lang)) return lang;
  }
  return DEFAULT_LOCALE;
}

// Agentensprache -> Widget-Locale. DER eine Normalisierer beider Eintrittspunkte
// (widgetHtml, withI18nScript); unbekannt/fehlend -> DEFAULT_LOCALE. Im Produktivpfad
// ist er die Identitaet: mcp-tools reicht die bereits ueber localeFor() aufgeloeste
// Sprache herein - hier entsteht KEIN zweiter Fallback (Test T-i18n-locale-keyset).
export const resolveWidgetLocale = (language) => resolveLocale([language], WIDGET_DICT);

// Nur die Tabelle der gerenderten Sprache ins Iframe projizieren: seit die Sprache
// serverseitig feststeht (E4), waeren die uebrigen Tabellen dort unerreichbarer Ballast.
// en -> {} (die Keys SIND die englischen Texte, s. Kopfkommentar).
export function widgetDictFor(locale) {
  const table = WIDGET_DICT[locale];
  return table ? { [locale]: table } : {};
}

// Key = englischer Text (siehe Kopfkommentar): en -> Key selbst, sonst Eintrag
// aus der Sprachtabelle, fehlender Eintrag -> Key (englischer Fallback).
export function translate(dict, locale, key) {
  if (locale === DEFAULT_LOCALE) return key;
  const table = dict[locale];
  if (table && Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  return key;
}

// Ersetzt die statischen Markup-Texte: jedes [data-i18n]-Element bekommt die
// Uebersetzung seines Keys als textContent (XSS-Disziplin wie widget-bind.js:
// NIE innerHTML).
export function localizeStaticLabels(doc, t) {
  const nodes = doc.querySelectorAll("[data-i18n]");
  for (const el of nodes) el.textContent = t(el.getAttribute("data-i18n"));
}

// Projiziert dieselben Funktionen als Iframe-Script-Text (eine Quelle, G5/S2 -
// exakt das buildBindScript-Muster). Bootstrap: Locale liegt servergerendert fest,
// window.HermesI18n bereitstellen (fuer die Inline-Skripte der Widgets) und
// die statischen Labels beim DOM-Ready lokalisieren.
function buildI18nScript(locale) {
  const body = [
    '"use strict";',
    `var DEFAULT_LOCALE = ${JSON.stringify(DEFAULT_LOCALE)};`,
    `var WIDGET_DICT = ${JSON.stringify(widgetDictFor(locale))};`,
    translate.toString(),
    localizeStaticLabels.toString(),
    // P13/E4: die Locale wird SERVERSEITIG entschieden (Agentensprache) und hier als
    // Literal eingesetzt - kein Browser-Signal mehr. Der frueher hier gelesene
    // navigator.language war die einzige verfuegbare Naeherung an die Chat-Sprache;
    // ein echtes Host-Signal existiert im MCP-Wire-Vertrag nicht (UI-14), deshalb
    // gewinnt die Achse, die der Nutzer selbst einstellt und die zum Anruf passt.
    // Folge: alle Betrachter derselben Karte sehen dieselbe Sprache (frueher UI-19).
    `var locale = ${JSON.stringify(locale)};`,
    "function t(key) { return translate(WIDGET_DICT, locale, key); }",
    "function localizeDocument() {",
    "  document.documentElement.lang = locale;",
    "  localizeStaticLabels(document, t);",
    "}",
    "window.HermesI18n = { locale: locale, t: t };",
    'if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", localizeDocument);',
    "else localizeDocument();",
  ].join("\n");
  return `<script>\n(function () {\n${body}\n})();\n</script>`;
}

// Ein fertiges Script je Widget-Sprache, EINMAL beim Modul-Load gebaut (kein Lazy-Init,
// P15). Schluessel = exakt die moeglichen resolveWidgetLocale-Ergebnisse.
export const I18N_SCRIPT_BY_LOCALE = Object.freeze(
  Object.fromEntries(WIDGET_LOCALES.map((locale) => [locale, buildI18nScript(locale)])),
);

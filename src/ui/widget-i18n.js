// Gemeinsame Lokalisierung fuer ALLE Hermes-Widgets. Der MCP ist international -
// das Widget zeigt seine Oberflaeche in der Sprache des Betrachters (Browser-
// Locale), NICHT hart deutsch.
//
// Mechanik (Muster widget-bind.js): dieselben Funktionen laufen in Node-Tests
// UND - via Function.prototype.toString projiziert - als self-contained
// Iframe-Script (I18N_SCRIPT, injiziert von widget-catalog.js in den <head>
// jedes Widgets, VOR den Inline-Skripten -> window.HermesI18n ist dort
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
    "AI cost, lifetime (EUR)": "KI-Kosten, gesamt (EUR)",
    "Your budget, lifetime (EUR)": "Dein Budget, gesamt (EUR)",
    "AI cost, this month (EUR)": "KI-Kosten, dieser Monat (EUR)",
    "Spend month": "Spend-Monat",
    "Reserved now (EUR)": "Aktuell reserviert (EUR)",
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
    "AI cost, lifetime (EUR)": "Coût IA, total (EUR)",
    "Your budget, lifetime (EUR)": "Votre budget, total (EUR)",
    "AI cost, this month (EUR)": "Coût IA, ce mois (EUR)",
    "Spend month": "Mois de dépense",
    "Reserved now (EUR)": "Réservé actuellement (EUR)",
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
    "Cancel call": "Annuler l'appel",
    "No answer": "Pas de réponse",
    "Busy": "Occupé",
    "Yes": "Oui",
    "No": "Non",
    "Unclear": "Incertain",
  },
};

// "de-DE"/"fr_CH" -> "de"/"fr". Nur der primaere Subtag entscheidet - die
// Widgets haben keine regionalen Varianten.
export function primaryLanguage(tag) {
  return String(tag || "").toLowerCase().split(/[-_]/)[0];
}

// Erster Kandidat (z.B. [navigator.language]), dessen Sprache
// unterstuetzt wird; nichts passt -> DEFAULT_LOCALE (fail-safe englisch).
export function resolveLocale(candidates, dict) {
  for (const candidate of candidates) {
    const lang = primaryLanguage(candidate);
    if (lang === DEFAULT_LOCALE) return lang;
    if (lang && Object.prototype.hasOwnProperty.call(dict, lang)) return lang;
  }
  return DEFAULT_LOCALE;
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
// exakt das buildBindScript-Muster). Bootstrap: Locale einmal aufloesen,
// window.HermesI18n bereitstellen (fuer die Inline-Skripte der Widgets) und
// die statischen Labels beim DOM-Ready lokalisieren.
function buildI18nScript() {
  const body = [
    '"use strict";',
    `var DEFAULT_LOCALE = ${JSON.stringify(DEFAULT_LOCALE)};`,
    `var WIDGET_DICT = ${JSON.stringify(WIDGET_DICT)};`,
    primaryLanguage.toString(),
    resolveLocale.toString(),
    translate.toString(),
    localizeStaticLabels.toString(),
    // Nur die Browser-Locale: der frueher zusaetzlich abgefragte ChatGPT-Host-Kandidat
    // (window.openai.locale) ist entfallen - das ausgelieferte Widget-HTML darf seit
    // widget-wire kein window.openai mehr enthalten, denn der EINZIGE erlaubte Sendeweg
    // ist jetzt tools/call-postMessage (Wire-Vertrag, siehe widgets/call.html). Der
    // server-seitige ChatGPT-Adapter (src/ui/adapters/chatgpt.js) bleibt dabei verdrahtet
    // und liefert dasselbe HTML weiter aus - die volle Entscheidung samt bekannter
    // Interaktivitaets-Luecke bei einem echten ChatGPT-Host steht in src/ui/registry.js.
    // Die Kandidaten-Liste hier bleibt (naechste Locale-Quelle = ein Eintrag mehr, sonst
    // nichts).
    'var locale = resolveLocale([navigator.language], WIDGET_DICT);',
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

// Geteilte i18n-Quelle, EINMAL je Widget in den <head> injiziert (widget-catalog.js).
export const I18N_SCRIPT = buildI18nScript();

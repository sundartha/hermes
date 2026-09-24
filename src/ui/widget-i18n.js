// Gemeinsame Lokalisierung fuer ALLE Hermes-Widgets. Der MCP ist international -
// das Widget zeigt seine Oberflaeche in der Sprache des Agenten, NICHT hart deutsch.
//
// T2-02/T-34 (cache-feste, sprachunabhaengige Resource-URIs): die ui://-Resource
// selbst ist jetzt EINE einzige, sprachneutrale Fassung (widget-catalog.js) - die
// Sprache reist NICHT MEHR im Katalog-Cache-Schluessel, sondern als Ergebnis-`_meta`
// der Widget-Werkzeuge (mcp-tools.js, WIDGET_LOCALE_META_KEY) und wird ERST IM
// IFRAME umgeschaltet. Grund: ChatGPT darf Resource-Inhalte bis zu 1 h cachen
// (developers.openai.com/plugins/deploy/app-review) - eine URI pro Sprache wuerde
// das Cache-Fenster mit einer haerteren Anforderung (Origin-Stabilitaet) in Konflikt
// bringen. Start-Locale ist deshalb IMMER "en" (sichtbar bis zum ersten Tool-
// Ergebnis, bewusste Folge s. T2-02-Pre-Mortem), das I18N-Script schaltet danach auf
// die servergerenderte Sprache um.
//
// Mechanik (Muster widget-bind.js): dieselben Funktionen laufen in Node-Tests
// UND - via Function.prototype.toString projiziert - als self-contained
// Iframe-Script (I18N_SCRIPT, injiziert von widget-catalog.js in den <head> jedes
// Widgets, VOR den Inline-Skripten -> window.HermesI18n ist dort synchron
// verfuegbar). Das Script registriert ALS ERSTES einen eigenen message-Listener
// (vor widget-bind.js' Listener, der spaeter vor </body> injiziert wird) - die
// Sprache steht damit fest, BEVOR dieselbe Host-Nachricht das structuredContent
// bindet.
//
// Uebersetzungs-Modell: die Keys SIND die englischen Anzeigetexte. Englisch ist
// damit der eingebaute Fallback (kein eigenes en-Dict, kein Key-Drift zwischen
// Markup und Woerterbuch): unbekannter Key oder unbekannte Sprache -> der Key
// selbst wird angezeigt. Die statischen Markup-Texte stehen ebenfalls auf
// Englisch und tragen data-i18n="<derselbe Text>"; faellt das Script aus,
// bleibt die Karte vollstaendig englisch statt kaputt (fail-safe).
// UI-Strings duerfen echte Umlaute/Akzente tragen (UTF-8, meta charset) -
// die ASCII-Disziplin gilt nur fuer Code-Kommentare.
import { METHOD_TOOL_RESULT } from "./widget-bind.js";

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
    "Your AI phone assistant": "Dein KI-Telefonassistent",
    "Recent calls": "Letzte Anrufe",
    "Number": "Nummer",
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
    "Not placed": "Nicht aufgebaut",
    "Unreachable": "Nicht erreichbar",
    "Result unknown": "Ergebnis unbekannt",
    "Duration limit": "Dauerlimit",
    "Budget used up": "Budget aufgebraucht",
    "Yes": "Ja",
    "No": "Nein",
    "Unclear": "Unklar",
    // T2-14 (N-10): Bestaetigungs-Ansicht im Call-Widget.
    "To": "Ziel",
    "Request": "Anliegen",
    "Briefing": "Briefing",
    "Call language": "Sprache des Anrufs",
    "Max. duration": "Maximaldauer",
    "Constraints": "Einschränkungen",
    "Mandate": "Mandat",
    "Context": "Kontext",
    "Diagnostic": "Diagnose",
    "Confirm call": "Anruf bestätigen",
    "Confirmation code unavailable — ask the assistant to prepare the call again.":
      "Bestätigungscode nicht verfügbar — bitte den Assistenten, den Anruf erneut vorzubereiten.",
    "Confirmation expired — ask the assistant to prepare the call again.":
      "Bestätigung abgelaufen — bitte den Assistenten, den Anruf erneut vorzubereiten.",
    "Unclear whether the call was placed — do not confirm again; check the call list.":
      "Unklar, ob der Anruf gestartet wurde — nicht erneut bestätigen; Anrufliste prüfen.",
    "Call was not started — ask the assistant to prepare it again.":
      "Der Anruf wurde nicht gestartet — bitte den Assistenten, ihn erneut vorzubereiten.",
    "Confirmed the call to {to} in the Hermes card; call_id {call_id}. Track it with get_call_status.":
      "Anruf an {to} in der Hermes-Karte bestätigt; call_id {call_id}. Mit get_call_status verfolgen.",
    "Confirmed a call to {to} in the Hermes card; the card received no response. Check with list_calls, do not call place_call again.":
      "Anruf an {to} in der Hermes-Karte bestätigt; die Karte hat keine Rückmeldung erhalten. Mit list_calls prüfen, nicht erneut place_call aufrufen.",
  },
  fr: {
    "Hermes · Call": "Hermes · Appel",
    "Hermes · Agent Status": "Hermes · Statut de l'agent",
    "Hermes · Agent Number": "Hermes · Numéro de l'agent",
    "Hermes · Recent Calls": "Hermes · Appels récents",
    "Your AI phone assistant": "Votre assistant téléphonique IA",
    "Recent calls": "Appels récents",
    "Number": "Numéro",
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
    "Not placed": "Non établi",
    "Unreachable": "Injoignable",
    "Result unknown": "Résultat inconnu",
    "Duration limit": "Limite de durée",
    "Budget used up": "Budget épuisé",
    "Yes": "Oui",
    "No": "Non",
    "Unclear": "Incertain",
    // T2-14 (N-10): Bestaetigungs-Ansicht im Call-Widget.
    "To": "Destinataire",
    "Request": "Demande",
    "Briefing": "Briefing",
    "Call language": "Langue de l'appel",
    "Max. duration": "Durée max.",
    "Constraints": "Contraintes",
    "Mandate": "Mandat",
    "Context": "Contexte",
    "Diagnostic": "Diagnostic",
    "Confirm call": "Confirmer l'appel",
    "Confirmation code unavailable — ask the assistant to prepare the call again.":
      "Code de confirmation indisponible — demandez à l'assistant de préparer à nouveau l'appel.",
    "Confirmation expired — ask the assistant to prepare the call again.":
      "Confirmation expirée — demandez à l'assistant de préparer à nouveau l'appel.",
    "Unclear whether the call was placed — do not confirm again; check the call list.":
      "Impossible de savoir si l'appel a été lancé — ne confirmez pas à nouveau ; vérifiez la liste des appels.",
    "Call was not started — ask the assistant to prepare it again.":
      "L'appel n'a pas été lancé — demandez à l'assistant de le préparer à nouveau.",
    "Confirmed the call to {to} in the Hermes card; call_id {call_id}. Track it with get_call_status.":
      "Appel vers {to} confirmé dans la carte Hermes ; call_id {call_id}. Suivez-le avec get_call_status.",
    "Confirmed a call to {to} in the Hermes card; the card received no response. Check with list_calls, do not call place_call again.":
      "Appel vers {to} confirmé dans la carte Hermes ; la carte n'a reçu aucune réponse. Vérifiez avec list_calls, n'appelez pas à nouveau place_call.",
  },
};

// Sprachfeld-Schluessel am Ergebnis-`_meta` der Widget-Werkzeuge (mcp-tools.js
// withWidgetLocale). NICHT in structuredContent (pinnte outputSchema/T-33-Snapshot,
// s. T2-02-Spec Kernentscheidung 4) und NICHT ueber die globale OpenAI-Bruecke
// gelesen (UI-03 verbietet ihre Nutzung im ausgelieferten HTML) - NUR ueber die
// MCP-Apps-Bruecke (ui/notifications/tool-result, params._meta).
export const WIDGET_LOCALE_META_KEY = "hermes/locale";

// "de-DE"/"fr_CH" -> "de"/"fr". Nur der primaere Subtag entscheidet - die
// Widgets haben keine regionalen Varianten.
export function primaryLanguage(tag) {
  return String(tag || "").toLowerCase().split(/[-_]/)[0];
}

// Erster Kandidat, dessen Sprache unterstuetzt wird; nichts passt -> DEFAULT_LOCALE
// (fail-safe englisch).
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

// Loest einen eingehenden Sprachkandidaten auf - nur bei einem GUELTIGEN
// String-Kandidaten (jeder andere Wert, inkl. Objekte/undefined, liefert null:
// die aktuelle Locale bleibt unangetastet, kein Wurf). `resolveLocale`
// entscheidet ueber gueltig/unterstuetzt (unbekannt -> en, dieselbe Regel wie
// ueberall sonst - kein zweiter Fallback). Reine Funktion (keine Parameter-
// Mutation, hoechstens 3 Argumente, F1) - das Anwenden (Dokument/Labels/
// HermesI18n) macht der Aufrufer.
export function incomingLocale(candidate, dict) {
  if (typeof candidate !== "string") return null;
  return resolveLocale([candidate], dict);
}

// Projiziert dieselben Funktionen als Iframe-Script-Text (eine Quelle, G5/S2 -
// exakt das buildBindScript-Muster). EIN Script fuer ALLE Sprachen (kein
// Locale-Parameter mehr, T2-02/S2): Start "en", danach Umschalten per
// ui/notifications/tool-result mit `params._meta[WIDGET_LOCALE_META_KEY]`.
// Registriert seinen Listener beim Modul-Lauf im <head> - also BEVOR
// widget-bind.js' Listener (vor </body> injiziert) registriert wird; die
// Listener-Reihenfolge ist die Registrierungsreihenfolge, die Sprache steht
// damit fest, bevor dieselbe Nachricht structuredContent bindet.
function buildI18nScript() {
  const body = [
    '"use strict";',
    `var DEFAULT_LOCALE = ${JSON.stringify(DEFAULT_LOCALE)};`,
    `var WIDGET_DICT = ${JSON.stringify(WIDGET_DICT)};`,
    `var METHOD_TOOL_RESULT = ${JSON.stringify(METHOD_TOOL_RESULT)};`,
    `var WIDGET_LOCALE_META_KEY = ${JSON.stringify(WIDGET_LOCALE_META_KEY)};`,
    primaryLanguage.toString(),
    resolveLocale.toString(),
    translate.toString(),
    localizeStaticLabels.toString(),
    incomingLocale.toString(),
    `var locale = ${JSON.stringify(DEFAULT_LOCALE)};`,
    "function t(key) { return translate(WIDGET_DICT, locale, key); }",
    "function localizeDocument() {",
    "  document.documentElement.lang = locale;",
    "  localizeStaticLabels(document, t);",
    "}",
    "window.HermesI18n = { locale: locale, t: t };",
    'if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", localizeDocument);',
    "else localizeDocument();",
    // Eigener Listener, unabhaengig von widget-bind.js (das die Nachricht ebenfalls
    // liest, um structuredContent zu binden) - dieselbe Host-Nachricht darf mehrere
    // Listener haben (Standard-DOM-Semantik), Reihenfolge = Registrierreihenfolge.
    "window.addEventListener(\"message\", function (event) {",
    "  var message = event && event.data;",
    "  if (!message || typeof message !== \"object\") return;",
    "  if (message.method !== METHOD_TOOL_RESULT) return;",
    "  var params = message.params;",
    "  if (!params || typeof params !== \"object\") return;",
    "  var meta = params._meta;",
    "  if (!meta || typeof meta !== \"object\") return;",
    "  var next = incomingLocale(meta[WIDGET_LOCALE_META_KEY], WIDGET_DICT);",
    "  if (next === null) return;",
    "  locale = next;",
    "  window.HermesI18n.locale = next;",
    "  localizeDocument();",
    "});",
  ].join("\n");
  return `<script>\n(function () {\n${body}\n})();\n</script>`;
}

// EIN fertiges Script, EINMAL beim Modul-Load gebaut (kein Lazy-Init, P15) -
// sprachunabhaengig, s. Kopfkommentar.
export const I18N_SCRIPT = buildI18nScript();

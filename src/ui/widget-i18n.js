import { METHOD_TOOL_RESULT } from "./widget-bind.js";

export const DEFAULT_LOCALE = "en";

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
    "Confirmation code unavailable — ask for a new prepare_call.":
      "Bestätigungscode nicht verfügbar — bitte um ein neues prepare_call.",
    "Confirmation expired — ask for a new prepare_call.":
      "Bestätigung abgelaufen — bitte um ein neues prepare_call.",
    "Unclear whether the call was placed — do not confirm again; check list_calls.":
      "Unklar, ob der Anruf gestartet wurde — nicht erneut bestätigen; list_calls prüfen.",
    "This confirmation was already sent — do not confirm again; check list_calls.":
      "Diese Bestätigung wurde bereits abgeschickt — nicht erneut bestätigen; list_calls prüfen.",
    "Call was not started — ask for a new prepare_call.":
      "Anruf wurde nicht gestartet — bitte um ein neues prepare_call.",
    "Confirmed the call to {to} (call_id {call_id}).":
      "Anruf an {to} bestätigt (call_id {call_id}).",
    "Confirmed a call to {to}; no response from the card yet. Check list_calls, do not call place_call again.":
      "Anruf an {to} bestätigt; noch keine Rückmeldung der Karte. list_calls prüfen, nicht erneut place_call aufrufen.",
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
    "Confirmation code unavailable — ask for a new prepare_call.":
      "Code de confirmation indisponible — redemandez un prepare_call.",
    "Confirmation expired — ask for a new prepare_call.":
      "Confirmation expirée — redemandez un prepare_call.",
    "Unclear whether the call was placed — do not confirm again; check list_calls.":
      "Incertain si l'appel a été lancé — ne confirmez pas à nouveau ; vérifiez list_calls.",
    "This confirmation was already sent — do not confirm again; check list_calls.":
      "Cette confirmation a déjà été envoyée — ne confirmez pas à nouveau ; vérifiez list_calls.",
    "Call was not started — ask for a new prepare_call.":
      "Appel non lancé — redemandez un prepare_call.",
    "Confirmed the call to {to} (call_id {call_id}).":
      "Appel vers {to} confirmé (call_id {call_id}).",
    "Confirmed a call to {to}; no response from the card yet. Check list_calls, do not call place_call again.":
      "Appel vers {to} confirmé ; pas encore de réponse de la carte. Vérifiez list_calls, n'appelez pas à nouveau place_call.",
  },
};

export const WIDGET_LOCALE_META_KEY = "hermes/locale";

export function primaryLanguage(tag) {
  return String(tag || "").toLowerCase().split(/[-_]/)[0];
}

export function resolveLocale(candidates, dict) {
  for (const candidate of candidates) {
    const lang = primaryLanguage(candidate);
    if (lang === DEFAULT_LOCALE) return lang;
    if (lang && Object.prototype.hasOwnProperty.call(dict, lang)) return lang;
  }
  return DEFAULT_LOCALE;
}

export function translate(dict, locale, key) {
  if (locale === DEFAULT_LOCALE) return key;
  const table = dict[locale];
  if (table && Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  return key;
}

export function localizeStaticLabels(doc, t) {
  const nodes = doc.querySelectorAll("[data-i18n]");
  for (const el of nodes) el.textContent = t(el.getAttribute("data-i18n"));
}

export function incomingLocale(candidate, dict) {
  if (typeof candidate !== "string") return null;
  return resolveLocale([candidate], dict);
}

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

export const I18N_SCRIPT = buildI18nScript();

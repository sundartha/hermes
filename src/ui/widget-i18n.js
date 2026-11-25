import { METHOD_TOOL_RESULT, METHOD_HOST_CONTEXT_CHANGED, INIT_ID, isObject } from "./widget-bind.js";

export const DEFAULT_LOCALE = "en";

export const WIDGET_DICT = {
  de: {
    "Hermes · Call": "Hermes · Anruf",
    "Hermes · Agent Status": "Hermes · Agent-Status",
    "Hermes · Agent Number": "Hermes · Agent-Nummer",
    "Hermes · Recent Calls": "Hermes · Letzte Anrufe",
    "Your AI phone assistant": "Dein KI-Telefonassistent",
    "At this number, Hermes takes calls for you and places calls on your behalf.": "Unter dieser Nummer nimmt Hermes Anrufe für dich an und ruft in deinem Auftrag an.",
    "Recent calls": "Letzte Anrufe",
    "Hermes handled": "Hermes hat zuletzt",
    "{n} calls": "{n} Anrufe",
    "{n} call": "{n} Anruf",
    "number 1": "einen",
    "number 2": "zwei",
    "number 3": "drei",
    "number 4": "vier",
    "number 5": "fünf",
    "number 6": "sechs",
    "number 7": "sieben",
    "number 8": "acht",
    "number 9": "neun",
    "number 10": "zehn",
    "number 11": "elf",
    "number 12": "zwölf",
    "recently.": "geführt.",
    "Hermes has handled": "Hermes hat",
    "no calls": "noch keine Anrufe",
    "yet.": "geführt.",
    "Unknown number": "Unbekannte Nummer",
    "Hermes is": "Hermes ist",
    "ready.": "bereit.",
    "of your monthly allowance is used.": "deines Monatskontingents sind verbraucht.",
    "Owner": "Inhaber",
    "Number": "Nummer",
    "Calls": "Anrufe",
    "{n} this month": "{n} in diesem Monat",
    "Outbound": "Ausgehend",
    "Inbound": "Eingehend",
    "Monthly usage (%)": "Monatsnutzung (%)",
    "Permissions": "Berechtigungen",
    "Connecting": "Verbindung",
    "Live": "Live",
    "Completed": "Abgeschlossen",
    "Failed": "Fehlgeschlagen",
    "Cancelled": "Abgebrochen",
    "Waiting for a line": "Wartet auf eine Leitung",
    "Hermes is waiting for a free line.": "Hermes wartet auf eine freie Leitung.",
    "Placing call": "Anruf wird platziert",
    "In call": "Im Gespräch",
    "Call ended": "Anruf beendet",
    "Hermes is calling.": "Hermes ruft an.",
    "Hermes is on the call.": "Hermes spricht gerade.",
    "The call is done.": "Der Anruf ist erledigt.",
    "Hermes is calling {name}.": "Hermes ruft {name} an.",
    "The call to {name} is done.": "Der Anruf bei {name} ist erledigt.",
    "Nobody picked up.": "Niemand hat abgenommen.",
    "The call was": "Du hast den Anruf",
    "cancelled.": "abgebrochen.",
    "Duration": "Dauer",
    "Reason": "Grund",
    "Result": "Ergebnis",
    "Assignment": "Auftrag",
    "Next step": "Nächster Schritt",
    "Next steps": "Nächste Schritte",
    "Appointment": "Termin",
    "Callback": "Rückruf",
    "Task": "Aufgabe",
    "Other": "Sonstiges",
    "Conversation": "Gespräch",
    "Other party": "Gegenüber",
    "Cancel call": "Anruf abbrechen",
    "No answer": "Nicht erreicht",
    "Busy": "Besetzt",
    "Not placed": "Nicht aufgebaut",
    "Unreachable": "Nicht erreichbar",
    "Result unknown": "Ergebnis unbekannt",
    "At capacity": "Ausgelastet",
    "Duration limit": "Dauerlimit",
    "Budget used up": "Budget aufgebraucht",
    "Result being evaluated": "Wird ausgewertet",
    "No longer updating": "Nicht mehr aktualisiert",
  },
  fr: {
    "Hermes · Call": "Hermes · Appel",
    "Hermes · Agent Status": "Hermes · Statut de l'agent",
    "Hermes · Agent Number": "Hermes · Numéro de l'agent",
    "Hermes · Recent Calls": "Hermes · Appels récents",
    "Your AI phone assistant": "Votre assistant téléphonique IA",
    "At this number, Hermes takes calls for you and places calls on your behalf.": "À ce numéro, Hermes prend vos appels et appelle en votre nom.",
    "Recent calls": "Appels récents",
    "Hermes handled": "Hermes a traité",
    "{n} calls": "{n} appels",
    "{n} call": "{n} appel",
    "number 1": "un",
    "number 2": "deux",
    "number 3": "trois",
    "number 4": "quatre",
    "number 5": "cinq",
    "number 6": "six",
    "number 7": "sept",
    "number 8": "huit",
    "number 9": "neuf",
    "number 10": "dix",
    "number 11": "onze",
    "number 12": "douze",
    "recently.": "récemment.",
    "Hermes has handled": "Hermes n'a traité",
    "no calls": "aucun appel",
    "yet.": "pour l'instant.",
    "Unknown number": "Numéro inconnu",
    "Hermes is": "Hermes est",
    "ready.": "prêt.",
    "of your monthly allowance is used.": "de votre quota mensuel sont utilisés.",
    "Owner": "Titulaire",
    "Number": "Numéro",
    "Calls": "Appels",
    "{n} this month": "{n} ce mois-ci",
    "Outbound": "Sortant",
    "Inbound": "Entrant",
    "Monthly usage (%)": "Utilisation mensuelle (%)",
    "Permissions": "Autorisations",
    "Connecting": "Connexion",
    "Live": "En direct",
    "Completed": "Terminé",
    "Failed": "Échec",
    "Cancelled": "Annulé",
    "Waiting for a line": "En attente d'une ligne",
    "Hermes is waiting for a free line.": "Hermes attend une ligne libre.",
    "Placing call": "Numérotation en cours",
    "In call": "En communication",
    "Call ended": "Appel terminé",
    "Hermes is calling.": "Hermes appelle.",
    "Hermes is on the call.": "Hermes est en ligne.",
    "The call is done.": "L'appel est terminé.",
    "Hermes is calling {name}.": "Hermes appelle {name}.",
    "The call to {name} is done.": "L'appel à {name} est terminé.",
    "Nobody picked up.": "Personne n'a répondu.",
    "The call was": "L'appel a été",
    "cancelled.": "annulé.",
    "Duration": "Durée",
    "Reason": "Motif",
    "Result": "Résultat",
    "Assignment": "Mission",
    "Next step": "Prochaine étape",
    "Next steps": "Prochaines étapes",
    "Appointment": "Rendez-vous",
    "Callback": "Rappel",
    "Task": "Tâche",
    "Other": "Autre",
    "Conversation": "Conversation",
    "Other party": "Interlocuteur",
    "Cancel call": "Annuler l'appel",
    "No answer": "Pas de réponse",
    "Busy": "Occupé",
    "Not placed": "Non établi",
    "Unreachable": "Injoignable",
    "Result unknown": "Résultat inconnu",
    "At capacity": "Saturé",
    "Duration limit": "Limite de durée",
    "Budget used up": "Budget épuisé",
    "Result being evaluated": "Évaluation en cours",
    "No longer updating": "Plus de mise à jour",
  },
};

export const WIDGET_LOCALE_META_KEY = "hermes/locale";
export const WIDGET_CONTENT_LOCALE_META_KEY = "hermes/content_locale";
export const STIMMEN_ANZAHL_META_KEY = "hermes/stimmen_anzahl";

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

function chooseLocale(userTag, contentTags, dict) {
  const user = primaryLanguage(userTag);
  const fits = contentTags.every((tag) => primaryLanguage(tag) === user);
  return fits ? resolveLocale([userTag], dict) : DEFAULT_LOCALE;
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
    `var METHOD_HOST_CONTEXT_CHANGED = ${JSON.stringify(METHOD_HOST_CONTEXT_CHANGED)};`,
    `var INIT_ID = ${JSON.stringify(INIT_ID)};`,
    `var WIDGET_LOCALE_META_KEY = ${JSON.stringify(WIDGET_LOCALE_META_KEY)};`,
    `var WIDGET_CONTENT_LOCALE_META_KEY = ${JSON.stringify(WIDGET_CONTENT_LOCALE_META_KEY)};`,
    isObject.toString(),
    primaryLanguage.toString(),
    resolveLocale.toString(),
    chooseLocale.toString(),
    translate.toString(),
    localizeStaticLabels.toString(),
    `var locale = ${JSON.stringify(DEFAULT_LOCALE)};`,
    "var tenantTag = null;",
    "var hostTag = null;",
    "var contentTags = [];",
    "function t(key) { return translate(WIDGET_DICT, locale, key); }",
    "function localizeDocument() {",
    "  document.documentElement.lang = locale;",
    "  localizeStaticLabels(document, t);",
    "}",
    "function applyLocale() {",
    "  locale = chooseLocale(tenantTag !== null ? tenantTag : hostTag, contentTags, WIDGET_DICT);",
    "  window.HermesI18n.locale = locale;",
    "  localizeDocument();",
    "}",
    "function observe(meta) {",
    "  if (!isObject(meta)) return;",
    "  if (typeof meta[WIDGET_LOCALE_META_KEY] === \"string\") tenantTag = meta[WIDGET_LOCALE_META_KEY];",
    "  if (WIDGET_CONTENT_LOCALE_META_KEY in meta) {",
    "    var tag = meta[WIDGET_CONTENT_LOCALE_META_KEY];",
    "    contentTags.push(typeof tag === \"string\" ? tag : null);",
    "  }",
    "  applyLocale();",
    "}",
    "function observeHost(hostContext) {",
    "  if (!isObject(hostContext) || typeof hostContext.locale !== \"string\") return;",
    "  hostTag = hostContext.locale;",
    "  applyLocale();",
    "}",
    "window.HermesI18n = { locale: locale, t: t, observe: observe };",
    'if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", localizeDocument);',
    "else localizeDocument();",
    "window.addEventListener(\"message\", function (event) {",
    "  var message = event && event.data;",
    "  if (!isObject(message)) return;",
    "  if (message.method === METHOD_TOOL_RESULT) {",
    "    if (isObject(message.params)) observe(message.params._meta);",
    "  } else if (message.method === METHOD_HOST_CONTEXT_CHANGED) {",
    "    observeHost(message.params);",
    "  } else if (message.id === INIT_ID && isObject(message.result)) {",
    "    observeHost(message.result.hostContext);",
    "  }",
    "});",
  ].join("\n");
  return `<script>\n(function () {\n${body}\n})();\n</script>`;
}

export const I18N_SCRIPT = buildI18nScript();

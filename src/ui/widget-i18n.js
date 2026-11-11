import { METHOD_TOOL_RESULT, METHOD_HOST_CONTEXT_CHANGED, INIT_ID, isObject } from "./widget-bind.js";

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
    "Outbound": "Ausgehend",
    "Inbound": "Eingehend",
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
    "Goal": "Ziel",
    "Outcome": "Fazit",
    "Next step": "Nächster Schritt",
    "Cancel call": "Anruf abbrechen",
    "No answer": "Nicht erreicht",
    "Busy": "Besetzt",
    "Not placed": "Nicht aufgebaut",
    "Unreachable": "Nicht erreichbar",
    "Result unknown": "Ergebnis unbekannt",
    "At capacity": "Ausgelastet",
    "Duration limit": "Dauerlimit",
    "Budget used up": "Budget aufgebraucht",
    "Goal reached": "Ziel erreicht",
    "Goal not reached": "Ziel nicht erreicht",
    "Result being evaluated": "Wird ausgewertet",
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
    "Outbound": "Sortant",
    "Inbound": "Entrant",
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
    "Goal": "Objectif",
    "Outcome": "Bilan",
    "Next step": "Prochaine étape",
    "Cancel call": "Annuler l'appel",
    "No answer": "Pas de réponse",
    "Busy": "Occupé",
    "Not placed": "Non établi",
    "Unreachable": "Injoignable",
    "Result unknown": "Résultat inconnu",
    "At capacity": "Saturé",
    "Duration limit": "Limite de durée",
    "Budget used up": "Budget épuisé",
    "Goal reached": "Objectif atteint",
    "Goal not reached": "Objectif non atteint",
    "Result being evaluated": "Évaluation en cours",
  },
};

export const WIDGET_LOCALE_META_KEY = "hermes/locale";
export const WIDGET_CONTENT_LOCALE_META_KEY = "hermes/content_locale";

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

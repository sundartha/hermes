// Recherche-Registry: EINE Stelle, die (a) die Anbieter-Tabelle haelt und (b) die
// SCHNITTMENGE aus globalem Master-Schalter und Per-Tenant-Setting bildet. Muster
// src/telephony/registry.js (ADAPTERS-Tabelle statt verstreuter Ternaries).
//
// Fail-closed: Master aus ODER Tenant aus -> null -> der Aufrufer laeuft byte-identisch
// zum Bestand weiter (kein Werkzeug im tools-Array, keine Gebuehr).
//
// Anbieterwechsel = eine Adapter-Datei + ein Tabelleneintrag. AL-P10c hat genau das
// vorgefuehrt: der In-Call-Anbieter wurde getauscht, ohne Umbau an in-call.js/ports.js.
// Ein zweiter In-Call-Anbieter passt jederzeit in die Tabelle - er wird erst gebaut, wenn
// er gebraucht wird.
import { anthropicWebSearch } from "./adapters/anthropic-web-search.js";
import { exaSearch } from "./adapters/exa-search.js";
import { config } from "../config.js";

const RESEARCH_PROVIDER = Object.freeze({
  ANTHROPIC_WEB_SEARCH: "anthropic_web_search",
  EXA_SEARCH: "exa_search",
});

const PRECALL_ADAPTERS = Object.freeze({
  [RESEARCH_PROVIDER.ANTHROPIC_WEB_SEARCH]: anthropicWebSearch,
});

const PRECALL_PROVIDER = RESEARCH_PROVIDER.ANTHROPIC_WEB_SEARCH;

// AL-P10b: der zweite Adapter-Platz. Anderer Vertrag (ports.js InCallSearchProvider),
// dieselbe Tabellen-Mechanik.
const IN_CALL_ADAPTERS = Object.freeze({
  [RESEARCH_PROVIDER.EXA_SEARCH]: exaSearch,
});

const IN_CALL_PROVIDER = RESEARCH_PROVIDER.EXA_SEARCH;

/**
 * @param {{ tenantAllows: boolean }} gate
 * @returns {import("./ports.js").PrecallResearchProvider|null}
 */
export function precallResearchProvider({ tenantAllows }) {
  if (!config.research.researchEnabled || !tenantAllows) return null;
  return PRECALL_ADAPTERS[PRECALL_PROVIDER];
}

/**
 * AL-P10b: EINE Stelle fuer die ANBIETER-Frage des In-Call-Nachschlags - Schnittmenge
 * aus Master-Schalter, Per-Tenant-Recht und vorhandenem Secret. OHNE Key fail-closed
 * inaktiv (ein Adapter ohne Secret liefert nur 401 und kostet Turn-Zeit). Die
 * CALL-seitigen Bedingungen (Richtung/Status/Kontingent) liegen in research/in-call.js.
 *
 * @param {{ tenantAllows: boolean }} gate
 * @returns {import("./ports.js").InCallSearchProvider|null}
 */
export function inCallSearchProvider({ tenantAllows }) {
  if (!config.research.lookupEnabled || !tenantAllows) return null;
  if (!config.research.exaApiKey) return null;
  return IN_CALL_ADAPTERS[IN_CALL_PROVIDER];
}

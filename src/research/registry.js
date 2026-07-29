// Recherche-Registry: EINE Stelle, die (a) die Anbieter-Tabelle haelt und (b) die
// SCHNITTMENGE aus globalem Master-Schalter und Per-Tenant-Setting bildet. Muster
// src/telephony/registry.js (ADAPTERS-Tabelle statt verstreuter Ternaries).
//
// Fail-closed: Master aus ODER Tenant aus -> null -> der Aufrufer laeuft byte-identisch
// zum Bestand weiter (kein Werkzeug im tools-Array, keine Gebuehr).
//
// Anbieterwechsel = eine Adapter-Datei + ein Tabelleneintrag. Dokumentierte
// Ausweichkandidaten: Brave Search und Exa (beide mit API-Key; sie kommen mit
// AL-P10b und deren eigenem, anderen Port-Vertrag - s. ports.js).
import { anthropicWebSearch } from "./adapters/anthropic-web-search.js";
import { config } from "../config.js";

const RESEARCH_PROVIDER = Object.freeze({ ANTHROPIC_WEB_SEARCH: "anthropic_web_search" });

const PRECALL_ADAPTERS = Object.freeze({
  [RESEARCH_PROVIDER.ANTHROPIC_WEB_SEARCH]: anthropicWebSearch,
});

const PRECALL_PROVIDER = RESEARCH_PROVIDER.ANTHROPIC_WEB_SEARCH;

/**
 * @param {{ tenantAllows: boolean }} gate
 * @returns {import("./ports.js").PrecallResearchProvider|null}
 */
export function precallResearchProvider({ tenantAllows }) {
  if (!config.research.researchEnabled || !tenantAllows) return null;
  return PRECALL_ADAPTERS[PRECALL_PROVIDER];
}

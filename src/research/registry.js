import { anthropicWebSearch } from "./adapters/anthropic-web-search.js";
import { exaSearch } from "./adapters/exa-search.js";
import { config } from "../config.js";
import { elevenLabsLookupCount } from "../store/state-ops.js";

const RESEARCH_PROVIDER = Object.freeze({
  ANTHROPIC_WEB_SEARCH: "anthropic_web_search",
  EXA_SEARCH: "exa_search",
});

const PRECALL_ADAPTERS = Object.freeze({
  [RESEARCH_PROVIDER.ANTHROPIC_WEB_SEARCH]: anthropicWebSearch,
});

const PRECALL_PROVIDER = RESEARCH_PROVIDER.ANTHROPIC_WEB_SEARCH;

const IN_CALL_ADAPTERS = Object.freeze({
  [RESEARCH_PROVIDER.EXA_SEARCH]: exaSearch,
});

const IN_CALL_PROVIDER = RESEARCH_PROVIDER.EXA_SEARCH;

export function precallResearchProvider({ tenantAllows }) {
  if (!config.research.researchEnabled || !tenantAllows) return null;
  return PRECALL_ADAPTERS[PRECALL_PROVIDER];
}

export function inCallSearchProvider({ tenantAllows }) {
  if (!config.research.lookupEnabled || !tenantAllows) return null;
  if (!config.research.exaApiKey) return null;
  return IN_CALL_ADAPTERS[IN_CALL_PROVIDER];
}

export const LOOKUP_MAX_PER_CALL = 2;

export function elevenLabsLookupProviderFor(call, resolveProfile) {
  if (call?.direction !== "outbound") return null;
  if (call?.status !== "active") return null;
  return inCallSearchProvider({
    tenantAllows: resolveProfile(call.tenantId)?.allowLookup === true,
  });
}

export function elevenLabsLookupAvailableFor(call, resolveProfile) {
  if (elevenLabsLookupProviderFor(call, resolveProfile) === null) return false;
  return elevenLabsLookupCount(call) < LOOKUP_MAX_PER_CALL;
}

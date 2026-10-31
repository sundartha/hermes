import { stripTrailingSlash } from "./umgebung.js";

export function researchRohwerte(umgebung) {
  const { env, numEnv, boolEnv } = umgebung;
  return {
    researchEnabled: boolEnv("RESEARCH_ENABLED", env.RESEARCH_ENABLED, { fallback: false }),
    researchMaxUses: 1,
    researchSearchFeeCents: numEnv("RESEARCH_SEARCH_FEE_CENTS", env.RESEARCH_SEARCH_FEE_CENTS, {
      fallback: 1,
      min: 0,
    }),

    lookupEnabled: boolEnv("LOOKUP_ENABLED", env.LOOKUP_ENABLED, { fallback: false }),
    lookupSearchFeeCents: numEnv("LOOKUP_SEARCH_FEE_CENTS", env.LOOKUP_SEARCH_FEE_CENTS, {
      fallback: 1,
      min: 0,
    }),
    exaApiKey: (env.EXA_API_KEY || "").trim(),
    exaApiBase: stripTrailingSlash((env.EXA_API_BASE || "https://api.exa.ai").trim()),
  };
}

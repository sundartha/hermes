import type { umgebungMit } from "./umgebung.ts";

export function rohwerteResearch(
  env: {
    RESEARCH_ENABLED?: string | undefined;
    RESEARCH_SEARCH_FEE_CENTS?: string | undefined;
    LOOKUP_ENABLED?: string | undefined;
    LOOKUP_SEARCH_FEE_CENTS?: string | undefined;
    EXA_API_KEY?: string | undefined;
    EXA_API_BASE?: string | undefined;
  },
  {
    boolEnv,
    numEnv,
    stripTrailingSlash,
    textEnv,
  }: Pick<ReturnType<typeof umgebungMit>, "boolEnv" | "numEnv" | "stripTrailingSlash" | "textEnv">,
): {
  researchEnabled: boolean;
  researchMaxUses: number;
  researchSearchFeeCents: number | undefined;
  lookupEnabled: boolean;
  lookupSearchFeeCents: number | undefined;
  exaApiKey: string;
  exaApiBase: string;
} {
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
    exaApiKey: (env.EXA_API_KEY ?? "").trim(),
    exaApiBase: stripTrailingSlash(textEnv(env.EXA_API_BASE, "https://api.exa.ai").trim()),
  };
}

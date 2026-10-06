export const LLM_PROVIDER = Object.freeze({ ANTHROPIC: "anthropic", DEEPSEEK: "deepseek" });

export const DEFAULT_LLM_PROVIDER = LLM_PROVIDER.ANTHROPIC;

export const LLM_PROVIDER_VALUES = Object.freeze(Object.values(LLM_PROVIDER));

export function usableFallbackProvider({ provider, fallback }) {
  if (!fallback) return "";
  if (fallback === provider) return "";
  return fallback;
}

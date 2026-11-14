import { DEFAULT_LLM_PROVIDER, LLM_PROVIDER_VALUES } from "../llm/provider.ts";
import { MS_PER_MINUTE } from "../utils/timer.js";

const LLM_BILLING_LATCH_COOLDOWN_MINUTES_DEFAULT = 15;

export function rohwerteLlm(env, { enumEnv, numEnv }) {
  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY || "",
    llmProvider: enumEnv("LLM_PROVIDER", env.LLM_PROVIDER, {
      allowed: LLM_PROVIDER_VALUES,
      fallback: DEFAULT_LLM_PROVIDER,
    }),
    deepseekApiKey: env.DEEPSEEK_API_KEY || "",
    llmProviderFallback: enumEnv("LLM_PROVIDER_FALLBACK", env.LLM_PROVIDER_FALLBACK, {
      allowed: LLM_PROVIDER_VALUES,
      fallback: "",
    }),
    claudeModel: env.CLAUDE_MODEL || "claude-haiku-4-5",

    llmRequestTimeoutMs: numEnv("LLM_REQUEST_TIMEOUT_MS", env.LLM_REQUEST_TIMEOUT_MS, {
      fallback: 3500,
      min: 1,
    }),
    llmMaxRetries: numEnv("LLM_MAX_RETRIES", env.LLM_MAX_RETRIES, { fallback: 2, min: 0 }),
    llmBackoffMs: numEnv("LLM_BACKOFF_MS", env.LLM_BACKOFF_MS, { fallback: 250, min: 0 }),
    llmBreakerThreshold: numEnv("LLM_BREAKER_THRESHOLD", env.LLM_BREAKER_THRESHOLD, {
      fallback: 5,
      min: 1,
    }),
    llmBreakerWindowMs: numEnv("LLM_BREAKER_WINDOW_MS", env.LLM_BREAKER_WINDOW_MS, {
      fallback: 10000,
      min: 1,
    }),
    llmBreakerCooldownMs: numEnv("LLM_BREAKER_COOLDOWN_MS", env.LLM_BREAKER_COOLDOWN_MS, {
      fallback: 30000,
      min: 1,
    }),
    llmBillingLatchCooldownMs: numEnv("LLM_BILLING_LATCH_COOLDOWN_MS", env.LLM_BILLING_LATCH_COOLDOWN_MS, {
      fallback: LLM_BILLING_LATCH_COOLDOWN_MINUTES_DEFAULT * MS_PER_MINUTE,
      min: 1,
    }),

    briefingModel: env.PRECALL_BRIEFING_MODEL || "claude-sonnet-5",
    briefingTimeoutMs: numEnv("PRECALL_BRIEFING_TIMEOUT_MS", env.PRECALL_BRIEFING_TIMEOUT_MS, {
      fallback: 6000,
      min: 1,
    }),

    summaryTimeoutMs: numEnv("CALL_SUMMARY_TIMEOUT_MS", env.CALL_SUMMARY_TIMEOUT_MS, {
      fallback: 20000,
      min: 1,
    }),
  };
}

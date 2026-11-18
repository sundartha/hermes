import { DEFAULT_LLM_PROVIDER, LLM_PROVIDER_VALUES } from "../llm/provider.ts";
import { MS_PER_MINUTE } from "../utils/timer.ts";
import type { umgebungMit } from "./umgebung.ts";

const LLM_BILLING_LATCH_COOLDOWN_MINUTES_DEFAULT = 15;

export function rohwerteLlm(
  env: {
    ANTHROPIC_API_KEY?: string | undefined;
    LLM_PROVIDER?: string | undefined;
    DEEPSEEK_API_KEY?: string | undefined;
    LLM_PROVIDER_FALLBACK?: string | undefined;
    CLAUDE_MODEL?: string | undefined;
    LLM_REQUEST_TIMEOUT_MS?: string | undefined;
    LLM_MAX_RETRIES?: string | undefined;
    LLM_BACKOFF_MS?: string | undefined;
    LLM_BREAKER_THRESHOLD?: string | undefined;
    LLM_BREAKER_WINDOW_MS?: string | undefined;
    LLM_BREAKER_COOLDOWN_MS?: string | undefined;
    LLM_BILLING_LATCH_COOLDOWN_MS?: string | undefined;
    PRECALL_BRIEFING_MODEL?: string | undefined;
    PRECALL_BRIEFING_TIMEOUT_MS?: string | undefined;
    CALL_SUMMARY_TIMEOUT_MS?: string | undefined;
  },
  {
    enumEnv,
    numEnv,
    textEnv,
  }: Pick<ReturnType<typeof umgebungMit>, "enumEnv" | "numEnv" | "textEnv">,
): {
  anthropicApiKey: string;
  llmProvider: string;
  deepseekApiKey: string;
  llmProviderFallback: string;
  claudeModel: string;
  llmRequestTimeoutMs: number | undefined;
  llmMaxRetries: number | undefined;
  llmBackoffMs: number | undefined;
  llmBreakerThreshold: number | undefined;
  llmBreakerWindowMs: number | undefined;
  llmBreakerCooldownMs: number | undefined;
  llmBillingLatchCooldownMs: number | undefined;
  briefingModel: string;
  briefingTimeoutMs: number | undefined;
  summaryTimeoutMs: number | undefined;
} {
  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? "",
    llmProvider: enumEnv("LLM_PROVIDER", env.LLM_PROVIDER, {
      allowed: LLM_PROVIDER_VALUES,
      fallback: DEFAULT_LLM_PROVIDER,
    }),
    deepseekApiKey: env.DEEPSEEK_API_KEY ?? "",
    llmProviderFallback: enumEnv("LLM_PROVIDER_FALLBACK", env.LLM_PROVIDER_FALLBACK, {
      allowed: LLM_PROVIDER_VALUES,
      fallback: "",
    }),
    claudeModel: textEnv(env.CLAUDE_MODEL, "claude-haiku-4-5"),

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
    llmBillingLatchCooldownMs: numEnv(
      "LLM_BILLING_LATCH_COOLDOWN_MS",
      env.LLM_BILLING_LATCH_COOLDOWN_MS,
      {
        fallback: LLM_BILLING_LATCH_COOLDOWN_MINUTES_DEFAULT * MS_PER_MINUTE,
        min: 1,
      },
    ),

    briefingModel: textEnv(env.PRECALL_BRIEFING_MODEL, "claude-sonnet-5"),
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

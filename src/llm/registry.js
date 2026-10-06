import { config } from "../config.js";
import { LLM_PROVIDER, LLM_PROVIDER_VALUES, usableFallbackProvider } from "./provider.js";
import { anthropicErrors, createAnthropicProvider } from "./adapters/anthropic.js";
import { createDeepseekProvider, deepseekErrors } from "./adapters/deepseek.js";
import { billingBlocked, markBillingBlocked } from "./billing-latch.js";

const ADAPTERS = Object.freeze({
  [LLM_PROVIDER.ANTHROPIC]: Object.freeze({
    create: createAnthropicProvider,
    errors: anthropicErrors,
    apiKey: () => config.llm.anthropicApiKey,
  }),
  [LLM_PROVIDER.DEEPSEEK]: Object.freeze({
    create: createDeepseekProvider,
    errors: deepseekErrors,
    apiKey: () => config.llm.deepseekApiKey,
  }),
});

function adapterEntry(provider) {
  if (!Object.hasOwn(ADAPTERS, provider))
    throw new Error(
      `LLM_PROVIDER '${provider}' nicht unterstuetzt (gueltig: ${LLM_PROVIDER_VALUES.join("|")})`,
    );
  return ADAPTERS[provider];
}

function fallbackProviderId() {
  return usableFallbackProvider({
    provider: config.llm.llmProvider,
    fallback: config.llm.llmProviderFallback,
  });
}

function routedProviderId(nowMs) {
  const primary = config.llm.llmProvider;
  const fallback = fallbackProviderId();
  if (!fallback) return primary;
  if (!billingBlocked({ provider: primary, nowMs })) return primary;
  return fallback;
}

function buildAdapter(provider, options) {
  const entry = adapterEntry(provider);
  return entry.create({ ...options, apiKey: entry.apiKey() });
}

function makeLatchRoutedProvider(adapterByProvider) {
  const current = () => adapterByProvider.get(routedProviderId(Date.now()));
  return {
    complete: (request) => current().complete(request),
    completeStream: (request, sink) => current().completeStream(request, sink),
    errors: {
      isTransient: (err) => current().errors.isTransient(err),
      isBillingError: (err) => current().errors.isBillingError(err),
    },
  };
}

export function createLlmProvider(options = {}) {
  const primary = config.llm.llmProvider;
  const fallback = fallbackProviderId();
  const primaryAdapter = buildAdapter(primary, options);
  if (!fallback) return primaryAdapter;
  return makeLatchRoutedProvider(
    new Map([
      [primary, primaryAdapter],
      [fallback, buildAdapter(fallback, options)],
    ]),
  );
}

export function activeLlmErrors() {
  return adapterEntry(routedProviderId(Date.now())).errors;
}

export function latchBillingBlockedProvider(nowMs) {
  if (!fallbackProviderId()) return null;
  const blockedProvider = routedProviderId(nowMs);
  const cooldownMs = config.llm.llmBillingLatchCooldownMs;
  const freshlyLatched = markBillingBlocked({ provider: blockedProvider, nowMs, cooldownMs });
  return { blockedProvider, nextProvider: routedProviderId(nowMs), cooldownMs, freshlyLatched };
}

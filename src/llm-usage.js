import { config } from "./config.js";
import * as store from "./store.js";
import { USAGE_EVENT_KIND } from "./store/defaults.js";
import { aiCostCents, inputTokensOf, tokenCostMicroCents } from "./store/state-ops.js";

function meterAiTokens({ tenantId, callId, tokens }) {
  if (!config.billing.paymentEnabled) return;
  store.recordUsageEvent({
    tenantId,
    callId,
    kind: USAGE_EVENT_KIND.AI_TOKEN,
    quantity: inputTokensOf(tokens) + tokens.outputTokens,
    costCents: aiCostCents(tokens, config.llm),
    costMicroCents: tokenCostMicroCents(tokens, config.llm),
  });
}

function billedTokens(usage) {
  return {
    inputUncachedTokens: usage.inputUncachedTokens,
    inputCacheWriteTokens: usage.inputCacheWriteTokens,
    inputCacheReadTokens: usage.inputCacheReadTokens,
    outputTokens: usage.outputTokens,
    model: usage.billingModelId,
  };
}

export function bookTokenUsage({ tenantId, callId, usage }) {
  const tokens = billedTokens(usage);
  store.trackUsage(tenantId, tokens, config.llm);
  meterAiTokens({ tenantId, callId, tokens });
}

export function bookEstimatedTokenUsage({ tenantId, usage }) {
  store.trackUsage(tenantId, billedTokens(usage), config.llm);
}

const ESTIMATE_CHARS_PER_TOKEN = 3;

export function estimatedAbortUsage({ promptChars, maxTokens, billingModelId }) {
  return {
    inputUncachedTokens: Math.ceil(promptChars / ESTIMATE_CHARS_PER_TOKEN),
    inputCacheWriteTokens: 0,
    inputCacheReadTokens: 0,
    outputTokens: maxTokens,
    estimated: true,
    billingModelId,
  };
}

export function bookResearchSearchFee({ tenantId, searches }) {
  if (!searches) return;
  store.addResearchFeeCostCents(tenantId, searches * config.research.researchSearchFeeCents);
}

export function bookLookupSearchFee({ tenantId }) {
  store.addResearchFeeCostCents(tenantId, config.research.lookupSearchFeeCents);
}

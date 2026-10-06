export const TEST_MODEL_CHEAP = "claude-haiku-4-5";
export const TEST_MODEL_EXPENSIVE = "claude-sonnet-5";

export const PRICES = Object.freeze({
  modelPricesUsd: Object.freeze({
    [TEST_MODEL_CHEAP]: { inPerMTok: 1.0, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1, outPerMTok: 5.0 },
    [TEST_MODEL_EXPENSIVE]: { inPerMTok: 3.0, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3, outPerMTok: 15.0 },
  }),
  usdToEur: 0.93,
  platformSpendCapCents: 800,
});

export function tokensWithCache({
  uncached = 0,
  cacheWrite = 0,
  cacheRead = 0,
  output = 0,
  model = TEST_MODEL_CHEAP,
}) {
  return {
    inputUncachedTokens: uncached,
    inputCacheWriteTokens: cacheWrite,
    inputCacheReadTokens: cacheRead,
    outputTokens: output,
    model,
  };
}

export function tokensOf(inputTokens, outputTokens = 0, model = TEST_MODEL_CHEAP) {
  return tokensWithCache({ uncached: inputTokens, output: outputTokens, model });
}

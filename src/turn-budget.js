export const PROVIDER_WEBHOOK_HARDCUT_MS = 15000;
export const TURN_NETWORK_RESERVE_MS = 1500;

const LLM_BACKOFF_FACTOR = 2;

export function llmTurnBudgetMs({ requestTimeoutMs, maxRetries, backoffMs }) {
  const attempts = maxRetries + 1;
  const backoffSum = backoffMs * (LLM_BACKOFF_FACTOR ** maxRetries - 1);
  return attempts * requestTimeoutMs + backoffSum;
}

function turnOverheadMs(synthTimeoutMs) {
  return synthTimeoutMs + TURN_NETWORK_RESERVE_MS;
}

export function turnBudgetMs({ requestTimeoutMs, maxRetries, backoffMs, synthTimeoutMs }) {
  return llmTurnBudgetMs({ requestTimeoutMs, maxRetries, backoffMs }) + turnOverheadMs(synthTimeoutMs);
}

export function turnBudgetOverrun(params) {
  const budgetMs = turnBudgetMs(params);
  if (budgetMs <= PROVIDER_WEBHOOK_HARDCUT_MS) return null;
  return {
    budgetMs,
    hardcutMs: PROVIDER_WEBHOOK_HARDCUT_MS,
    overrunMs: budgetMs - PROVIDER_WEBHOOK_HARDCUT_MS,
  };
}

export const MAX_TOOL_ROUNDS_PER_TURN = 4;

export function turnLoopDeadlineMs(synthTimeoutMs) {
  return Math.max(0, PROVIDER_WEBHOOK_HARDCUT_MS - turnOverheadMs(synthTimeoutMs));
}

export function roundFitsDeadline({ elapsedMs, deadlineMs, requestTimeoutMs }) {
  return elapsedMs + requestTimeoutMs <= deadlineMs;
}


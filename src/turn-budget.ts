export const PROVIDER_WEBHOOK_HARDCUT_MS = 15000;
export const TURN_NETWORK_RESERVE_MS = 1500;

const LLM_BACKOFF_FACTOR = 2;

interface Zugparameter {
  requestTimeoutMs: number;
  maxRetries: number;
  backoffMs: number;
  synthTimeoutMs: number;
}

export function llmTurnBudgetMs({
  requestTimeoutMs,
  maxRetries,
  backoffMs,
}: Pick<Zugparameter, "requestTimeoutMs" | "maxRetries" | "backoffMs">): number {
  const attempts = maxRetries + 1;
  const backoffSum = backoffMs * (LLM_BACKOFF_FACTOR ** maxRetries - 1);
  return attempts * requestTimeoutMs + backoffSum;
}

function turnOverheadMs(synthTimeoutMs: number): number {
  return synthTimeoutMs + TURN_NETWORK_RESERVE_MS;
}

export function turnBudgetMs({ requestTimeoutMs, maxRetries, backoffMs, synthTimeoutMs }: Zugparameter): number {
  return llmTurnBudgetMs({ requestTimeoutMs, maxRetries, backoffMs }) + turnOverheadMs(synthTimeoutMs);
}

export function turnBudgetOverrun(params: Zugparameter): { budgetMs: number; hardcutMs: number; overrunMs: number } | null {
  const budgetMs = turnBudgetMs(params);
  if (budgetMs <= PROVIDER_WEBHOOK_HARDCUT_MS) return null;
  return {
    budgetMs,
    hardcutMs: PROVIDER_WEBHOOK_HARDCUT_MS,
    overrunMs: budgetMs - PROVIDER_WEBHOOK_HARDCUT_MS,
  };
}

export const MAX_TOOL_ROUNDS_PER_TURN = 4;

export function turnLoopDeadlineMs(synthTimeoutMs: number): number {
  return Math.max(0, PROVIDER_WEBHOOK_HARDCUT_MS - turnOverheadMs(synthTimeoutMs));
}

export function roundFitsDeadline({
  elapsedMs,
  deadlineMs,
  requestTimeoutMs,
}: {
  elapsedMs: number;
  deadlineMs: number;
  requestTimeoutMs: number;
}): boolean {
  return elapsedMs + requestTimeoutMs <= deadlineMs;
}


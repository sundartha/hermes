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

export function turnBudgetMs({ requestTimeoutMs, maxRetries, backoffMs, synthTimeoutMs }: Zugparameter): number {
  return llmTurnBudgetMs({ requestTimeoutMs, maxRetries, backoffMs }) + synthTimeoutMs + TURN_NETWORK_RESERVE_MS;
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

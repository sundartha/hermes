const blockedUntilMs = new Map<string, number>();

export function markBillingBlocked({
  provider,
  nowMs,
  cooldownMs,
}: {
  provider: string;
  nowMs: number;
  cooldownMs: number;
}): boolean {
  const warBlockiert = billingBlocked({ provider, nowMs });
  blockedUntilMs.set(provider, nowMs + cooldownMs);
  return !warBlockiert;
}

export function billingBlocked({ provider, nowMs }: { provider: string; nowMs: number }): boolean {
  return nowMs < (blockedUntilMs.get(provider) ?? 0);
}

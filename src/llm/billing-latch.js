const blockedUntilMs = new Map();

export function markBillingBlocked({ provider, nowMs, cooldownMs }) {
  const warBlockiert = billingBlocked({ provider, nowMs });
  blockedUntilMs.set(provider, nowMs + cooldownMs);
  return !warBlockiert;
}

export function billingBlocked({ provider, nowMs }) {
  return nowMs < (blockedUntilMs.get(provider) ?? 0);
}

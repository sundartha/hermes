export async function setSubscriptionCancellation({ store, billing, tenant, cancel }) {
  const before = store.tenantSubscription(tenant);
  if (!before.subscriptionId) return { ok: false, reason: "no_subscription" };
  if (before.cancelAtPeriodEnd === cancel) {
    return {
      ok: true,
      cancelAtPeriodEnd: before.cancelAtPeriodEnd,
      currentPeriodEnd: before.currentPeriodEnd,
      alreadyApplied: true,
    };
  }
  const idempotencyKey = (cancel ? "cancel_sched_" : "cancel_unsched_") + before.subscriptionId;
  const op = cancel ? billing.scheduleCancellation : billing.unscheduleCancellation;
  const result = await op({ subscriptionId: before.subscriptionId, idempotencyKey });
  const patch = { cancelAtPeriodEnd: result.cancelAtPeriodEnd };
  if (result.currentPeriodEnd != null) patch.currentPeriodEnd = result.currentPeriodEnd;
  store.setTenantSubscription(tenant, patch);
  return {
    ok: true,
    cancelAtPeriodEnd: result.cancelAtPeriodEnd,
    currentPeriodEnd: result.currentPeriodEnd ?? before.currentPeriodEnd,
    alreadyApplied: false,
  };
}

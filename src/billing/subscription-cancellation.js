import { randomUUID } from "node:crypto";
import { makeKeyedChainMutex } from "../chain-mutex.js";

const kuendigungsSperre = makeKeyedChainMutex();

function schluesselJeUebergang(cancel, subscriptionId) {
  return `${cancel ? "cancel_sched_" : "cancel_unsched_"}${subscriptionId}_${randomUUID()}`;
}

async function wendeKuendigungAn({ store, billing, tenant, cancel }) {
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
  const idempotencyKey = schluesselJeUebergang(cancel, before.subscriptionId);
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

export function setSubscriptionCancellation(auftrag) {
  return kuendigungsSperre(auftrag.tenant, () => wendeKuendigungAn(auftrag));
}

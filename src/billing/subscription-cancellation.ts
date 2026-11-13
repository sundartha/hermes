import { randomUUID } from "node:crypto";
import { makeKeyedChainMutex } from "../chain-mutex.js";

const kuendigungsSperre: <T>(key: string, fn: () => Promise<T>) => Promise<T> = makeKeyedChainMutex();

interface Subscription {
  subscriptionId?: string | null;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: number | null;
}

interface Result { cancelAtPeriodEnd: boolean; currentPeriodEnd?: number | null }

type Ergebnis =
  | { ok: false; reason: string }
  | {
      ok: true;
      cancelAtPeriodEnd: boolean | undefined;
      currentPeriodEnd: number | null | undefined;
      alreadyApplied: boolean;
    };

interface Auftrag {
  store: {
    tenantSubscription: (tenant: string) => Subscription;
    setTenantSubscription: (tenant: string, patch: Subscription) => unknown;
  };
  billing: Record<
    "scheduleCancellation" | "unscheduleCancellation",
    (args: { subscriptionId: string; idempotencyKey: string }) => Promise<Result>
  >;
  tenant: string;
  cancel: boolean;
}

function schluesselJeUebergang(cancel: boolean, subscriptionId: string) {
  return `${cancel ? "cancel_sched_" : "cancel_unsched_"}${subscriptionId}_${randomUUID()}`;
}

async function wendeKuendigungAn({ store, billing, tenant, cancel }: Auftrag): Promise<Ergebnis> {
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
  const patch: Subscription = { cancelAtPeriodEnd: result.cancelAtPeriodEnd };
  if (result.currentPeriodEnd != null) patch.currentPeriodEnd = result.currentPeriodEnd;
  store.setTenantSubscription(tenant, patch);
  return {
    ok: true,
    cancelAtPeriodEnd: result.cancelAtPeriodEnd,
    currentPeriodEnd: result.currentPeriodEnd ?? before.currentPeriodEnd,
    alreadyApplied: false,
  };
}

export function setSubscriptionCancellation(auftrag: Auftrag): Promise<Ergebnis> {
  return kuendigungsSperre(auftrag.tenant, () => wendeKuendigungAn(auftrag));
}

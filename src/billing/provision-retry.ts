import { KYC_OUTBOUND_MIN } from "../begriffe/mandant.js";
import {
  failedNumberCount,
  markTenantNeedsManualReconcile,
  tenantActiveSubscriber,
  tenantStripe,
} from "../store/state-ops.js";
import { NUMBER_DISPLAY_STATUS, numberStatusFor, type NummernZustand } from "../store/views.ts";
import { isHoldCapablePaymentMethodType } from "./payment-method-eligibility.ts";

export const PROVISION_RETRY_OUTCOME = Object.freeze({
  RETRY: "retry",
  DISABLED: "disabled",
  NOT_FAILED: "not_failed",
  NO_ACTIVE_SUBSCRIPTION: "no_active_subscription",
  PAYMENT_METHOD_UNSUITABLE: "payment_method_unsuitable",
  ATTEMPTS_EXHAUSTED: "attempts_exhausted",
  THROTTLED: "throttled",
  ERROR: "error",
});

const failedNumberCountOf: (state: unknown, tenantId: string) => number = failedNumberCount;

const NO_RETRY_ATTEMPTS = 0;

interface RetryDecision {
  retry: boolean;
  outcome: string;
  attempts: number;
}

interface RetryStore {
  load: () => NummernZustand;
  save: () => void;
  withStoreLock: (arbeit: () => void) => Promise<unknown>;
}

export function resolveAutoProvisionRetry(
  state: NummernZustand,
  { tenantId, maxAttempts, kycMinLevel = KYC_OUTBOUND_MIN }: { tenantId: string; maxAttempts: number; kycMinLevel?: typeof KYC_OUTBOUND_MIN },
): RetryDecision {
  if (maxAttempts <= 0)
    return { retry: false, outcome: PROVISION_RETRY_OUTCOME.DISABLED, attempts: NO_RETRY_ATTEMPTS };
  if (numberStatusFor(state, tenantId) !== NUMBER_DISPLAY_STATUS.FAILED)
    return { retry: false, outcome: PROVISION_RETRY_OUTCOME.NOT_FAILED, attempts: NO_RETRY_ATTEMPTS };
  if (!tenantActiveSubscriber(state, tenantId, kycMinLevel))
    return {
      retry: false,
      outcome: PROVISION_RETRY_OUTCOME.NO_ACTIVE_SUBSCRIPTION,
      attempts: NO_RETRY_ATTEMPTS,
    };
  if (!isHoldCapablePaymentMethodType(tenantStripe(state, tenantId).paymentMethodType))
    return {
      retry: false,
      outcome: PROVISION_RETRY_OUTCOME.PAYMENT_METHOD_UNSUITABLE,
      attempts: NO_RETRY_ATTEMPTS,
    };
  const attempts = failedNumberCountOf(state, tenantId);
  if (attempts >= maxAttempts)
    return { retry: false, outcome: PROVISION_RETRY_OUTCOME.ATTEMPTS_EXHAUSTED, attempts };
  return { retry: true, outcome: PROVISION_RETRY_OUTCOME.RETRY, attempts };
}

async function markExhausted({ store, tenantId }: { store: RetryStore; tenantId: string }): Promise<void> {
  await store.withStoreLock(() => {
    const state = store.load();
    if (markTenantNeedsManualReconcile(state, tenantId).changed) store.save();
  });
}

const KEIN_ZEITRIEGEL = (): Promise<boolean> => Promise.resolve(true);

export async function retriggerFailedProvisioning({
  store,
  provision,
  tenantId,
  maxAttempts,
  claimAttempt = KEIN_ZEITRIEGEL,
}: {
  store: RetryStore;
  provision: (tenantId: string) => Promise<unknown>;
  tenantId: string;
  maxAttempts: number;
  claimAttempt?: () => Promise<boolean>;
}): Promise<RetryDecision> {
  try {
    const decision = resolveAutoProvisionRetry(store.load(), { tenantId, maxAttempts });
    if (decision.outcome === PROVISION_RETRY_OUTCOME.ATTEMPTS_EXHAUSTED)
      await markExhausted({ store, tenantId });
    if (!decision.retry) return decision;
    if (!(await claimAttempt()))
      return { ...decision, retry: false, outcome: PROVISION_RETRY_OUTCOME.THROTTLED };
    await provision(tenantId);
    return decision;
  } catch (err) {
    console.error("[provision-retry]", err instanceof Error ? err.message : String(err));
    return { retry: false, outcome: PROVISION_RETRY_OUTCOME.ERROR, attempts: NO_RETRY_ATTEMPTS };
  }
}

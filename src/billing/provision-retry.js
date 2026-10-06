import { KYC_OUTBOUND_MIN } from "../store/defaults.js";
import {
  failedNumberCount,
  markTenantNeedsManualReconcile,
  tenantActiveSubscriber,
  tenantStripe,
} from "../store/state-ops.js";
import { NUMBER_DISPLAY_STATUS, numberStatusFor } from "../store/views.js";
import { isHoldCapablePaymentMethodType } from "./payment-method-eligibility.js";

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

const NO_RETRY_ATTEMPTS = 0;

export function resolveAutoProvisionRetry(state, { tenantId, maxAttempts, kycMinLevel = KYC_OUTBOUND_MIN }) {
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
  const attempts = failedNumberCount(state, tenantId);
  if (attempts >= maxAttempts)
    return { retry: false, outcome: PROVISION_RETRY_OUTCOME.ATTEMPTS_EXHAUSTED, attempts };
  return { retry: true, outcome: PROVISION_RETRY_OUTCOME.RETRY, attempts };
}

async function markExhausted({ store, tenantId }) {
  await store.withStoreLock(() => {
    const state = store.load();
    if (markTenantNeedsManualReconcile(state, tenantId).changed) store.save();
  });
}

const KEIN_ZEITRIEGEL = async () => true;

export async function retriggerFailedProvisioning({
  store,
  provision,
  tenantId,
  maxAttempts,
  claimAttempt = KEIN_ZEITRIEGEL,
}) {
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
    console.error("[provision-retry]", err.message);
    return { retry: false, outcome: PROVISION_RETRY_OUTCOME.ERROR, attempts: NO_RETRY_ATTEMPTS };
  }
}

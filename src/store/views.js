import { NUMBER_STATUS, GLOBAL_CAP_REASON } from "./defaults.js";
import { findTenant, resolveCallLanguage } from "./state-ops.js";

export function publicCall({
  streamToken,
  _finished,
  summarySmsSentAt,
  summaryMailSentAt,
  telnyxConversationId,
  callerTurns,
  estimatedCostCents,
  estimatedCostSpendMonthKey,
  estimatedCostPeriodKey,
  actualCostMicroCents,
  costTruedAt,
  costTruedSource,
  costTruingAttempts,
  inboxEntryAt,
  inboxSeenAt,
  fromRegistrationSource,
  costProfile,
  elDetectorCounts,
  webhookAnchors,
  elBoundAt,
  elFallbackAt,
  elNachlaufStartedAt,
  ...rest
}) {
  return rest;
}

export function findActiveNumber(state, tenantId, provider) {
  return state.numbers.find(
    (number) =>
      number.tenantId === tenantId &&
      number.status === NUMBER_STATUS.ACTIVE &&
      (provider === undefined || number.provider === provider),
  );
}

export function tenantLanguage(state, tenantId) {
  return resolveCallLanguage(state, { tenantId, numberRecord: findActiveNumber(state, tenantId) });
}

export function hasActiveNumber(state) {
  return state.numbers.some((number) => number.status === NUMBER_STATUS.ACTIVE);
}

export function countActiveNumbers(state) {
  return state.numbers.filter((number) => number.status === NUMBER_STATUS.ACTIVE).length;
}

export function activeNumberFor(state, tenantId) {
  const hit = findActiveNumber(state, tenantId);
  return hit ? hit.e164 : "";
}

export const NUMBER_DISPLAY_STATUS = Object.freeze({
  ACTIVE: "active",
  PROVISIONING: "provisioning",
  REQUESTED: "requested",
  FAILED: "failed",
  BLOCKED: "blocked",
  NONE: "none",
});

export function numberStatusFor(state, tenantId) {
  const own = state.numbers.filter((number) => number.tenantId === tenantId);
  if (own.some((number) => number.status === NUMBER_STATUS.ACTIVE)) return NUMBER_DISPLAY_STATUS.ACTIVE;
  if (own.some((number) => number.status === NUMBER_STATUS.PROVISIONING || number.status === NUMBER_STATUS.CAPTURING))
    return NUMBER_DISPLAY_STATUS.PROVISIONING;
  if (own.some((number) => number.status === NUMBER_STATUS.REQUESTED)) return NUMBER_DISPLAY_STATUS.REQUESTED;
  if (own.some((number) => number.status === NUMBER_STATUS.FAILED)) return NUMBER_DISPLAY_STATUS.FAILED;
  if (findTenant(state, tenantId)?.numberProvisionSkipReason === GLOBAL_CAP_REASON)
    return NUMBER_DISPLAY_STATUS.BLOCKED;
  return NUMBER_DISPLAY_STATUS.NONE;
}

export function upcomingCalendar(store, tenantId) {
  return store.getCalendar(tenantId).filter((event) => event.end >= new Date().toISOString());
}

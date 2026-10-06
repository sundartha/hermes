import { liveVoiceSpendCents } from "./billing/metering.js";

export const BUDGET_AXIS = Object.freeze({
  TENANT: "budget_tenant",
});

const BUDGET_AXIS_VALUES = Object.freeze(new Set(Object.values(BUDGET_AXIS)));

export function blockingBudgetAxis({ store, billing, tenantId }) {
  const liveCents = liveVoiceSpendCents(store.activeCallsFor(tenantId), Date.now());
  return store.liveBudgetExceeded(tenantId, liveCents, billing) ? BUDGET_AXIS.TENANT : null;
}

export function isBudgetAxis(reason) {
  return BUDGET_AXIS_VALUES.has(reason);
}

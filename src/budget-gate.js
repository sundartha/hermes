import { liveVoiceSpendCents } from "./billing/metering.js";

export const BUDGET_AXIS = Object.freeze({
  TENANT: "budget_tenant",
});

const BUDGET_AXIS_VALUES = Object.freeze(new Set(Object.values(BUDGET_AXIS)));

function axisOf({ store, billing, tenantId, activeCalls }) {
  const liveCents = liveVoiceSpendCents(activeCalls, Date.now());
  return store.liveBudgetExceeded(tenantId, liveCents, billing) ? BUDGET_AXIS.TENANT : null;
}

export function blockingBudgetAxis({ store, billing, tenantId }) {
  return axisOf({ store, billing, tenantId, activeCalls: store.activeCallsFor(tenantId) });
}

export async function blockingBudgetAxisFrisch({ store, billing, tenantId }) {
  await store.nutzungAuffrischen(tenantId);
  return axisOf({ store, billing, tenantId, activeCalls: await store.activeCallsForSql(tenantId) });
}

export function isBudgetAxis(reason) {
  return BUDGET_AXIS_VALUES.has(reason);
}

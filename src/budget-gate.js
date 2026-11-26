import { liveVoiceSpendCents } from "./billing/metering.js";
import { NUTZUNG_AUFFRISCHEN_FRIST_MS } from "./begriffe/speicher.ts";

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

async function laufendeAnrufeBinnenFrist(store, tenantId) {
  let uhr;
  const abgelaufen = new Promise((fertig) => {
    uhr = setTimeout(() => fertig(null), NUTZUNG_AUFFRISCHEN_FRIST_MS);
  });
  const lesen = Promise.resolve()
    .then(() => store.activeCallsForSql(tenantId))
    .catch(() => null);
  const gelesen = await Promise.race([lesen, abgelaufen]).finally(() => clearTimeout(uhr));
  if (gelesen) return gelesen;
  console.error("[budget] laufende Anrufe nicht binnen der Frist gelesen, Pruefung mit dem Stand des Prozesses");
  return store.activeCallsFor(tenantId);
}

export async function blockingBudgetAxisFrisch({ store, billing, tenantId }) {
  await store.nutzungAuffrischen(tenantId);
  return axisOf({ store, billing, tenantId, activeCalls: await laufendeAnrufeBinnenFrist(store, tenantId) });
}

export function isBudgetAxis(reason) {
  return BUDGET_AXIS_VALUES.has(reason);
}

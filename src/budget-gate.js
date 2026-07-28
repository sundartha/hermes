// EINE Quelle (G5) fuer die Frage "welche Budget-Achse sperrt gerade?" - Regel 1,
// Token-Achse. Tenant-Cap UND Plattform-Notaus bleiben eine SCHNITTMENGE: es sperrt,
// wer zuerst sperrt; die Reihenfolge bestimmt nur den Grund-Token. Reine Query, kein IO,
// kein Log (jeder Aufrufer loggt mit seinem eigenen Kontext).
export const BUDGET_AXIS = Object.freeze({
  TENANT: "budget_tenant", // Grund-Token seit telnyx-p6 im Shim-Log - Wortlaut bleibt
  GLOBAL: "budget_global",
});

const BUDGET_AXIS_VALUES = Object.freeze(new Set(Object.values(BUDGET_AXIS)));

export function blockingBudgetAxis({ store, billing, tenantId }) {
  if (store.budgetExceeded(tenantId, billing)) return BUDGET_AXIS.TENANT;
  if (store.globalBudgetExceeded(billing)) return BUDGET_AXIS.GLOBAL;
  return null;
}

// Ist ein Turn-Abbruchgrund eine GELD-Achse (im Gegensatz zur Zeit-Frist)? Die Aufrufer
// reagieren auf Geld anders als auf Zeit: auflegen statt weitersprechen (Regel 1).
export function isBudgetAxis(reason) {
  return BUDGET_AXIS_VALUES.has(reason);
}

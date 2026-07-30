// EINE Quelle (G5) fuer die Frage "sperrt die Geld-Achse gerade?" - Regel 1, Token-Achse.
// Seit KS-P9/E10 gibt es GENAU EINE Geld-Achse (die pro-Tenant-Decke); die Plattform-Achse
// misst und warnt nur noch. Reine Query, kein IO, kein Log (jeder Aufrufer loggt mit
// seinem eigenen Kontext).
export const BUDGET_AXIS = Object.freeze({
  TENANT: "budget_tenant", // Grund-Token seit telnyx-p6 im Shim-Log - Wortlaut bleibt
});

const BUDGET_AXIS_VALUES = Object.freeze(new Set(Object.values(BUDGET_AXIS)));

export function blockingBudgetAxis({ store, billing, tenantId }) {
  return store.budgetExceeded(tenantId, billing) ? BUDGET_AXIS.TENANT : null;
}

// Ist ein Turn-Abbruchgrund eine GELD-Achse (im Gegensatz zur Zeit-Frist)? Die Aufrufer
// reagieren auf Geld anders als auf Zeit: auflegen statt weitersprechen (Regel 1).
export function isBudgetAxis(reason) {
  return BUDGET_AXIS_VALUES.has(reason);
}

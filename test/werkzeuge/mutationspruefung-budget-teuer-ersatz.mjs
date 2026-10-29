import { BUDGET_MS as ECHTES_BUDGET_MS } from "../../tools/mutationspruefung/budget.mjs";
import { leiteBudgetUm } from "./mutationspruefung-budget-umleitung.mjs";

const SEHR_TEUER_MS = 1_000_000_000;

leiteBudgetUm(import.meta.url);

export const BUDGET_MS = ECHTES_BUDGET_MS;
export const SCHAETZUNG_MS = { aufruf: SEHR_TEUER_MS, mutant: SEHR_TEUER_MS };

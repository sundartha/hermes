import { leiteBudgetUm } from "./mutationspruefung-budget-umleitung.mjs";

const EINE_SEKUNDE_MS = 1000;

leiteBudgetUm(import.meta.url);

export const BUDGET_MS = { normal: EINE_SEKUNDE_MS, testumbau: EINE_SEKUNDE_MS };
export const SCHAETZUNG_MS = { aufruf: 0, mutant: 0 };

import { SCHAETZUNG_MS as ECHTE_SCHAETZUNG_MS } from "../../tools/mutationspruefung/budget.mjs";
import { leiteBudgetUm } from "./mutationspruefung-budget-umleitung.mjs";

const MS_JE_MINUTE = 60_000;
const NORMAL_MINUTEN = 15;
const TESTUMBAU_MINUTEN = 60;

leiteBudgetUm(import.meta.url);

export const BUDGET_MS = { normal: NORMAL_MINUTEN * MS_JE_MINUTE, testumbau: TESTUMBAU_MINUTEN * MS_JE_MINUTE };
export const SCHAETZUNG_MS = ECHTE_SCHAETZUNG_MS;

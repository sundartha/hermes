import { DEFAULT_GREETING } from "../i18n/locales.ts";
import { defaultSettings, demoCalendar } from "../db/migrate.js";
import { BOOTSTRAP_TENANT_ID } from "../begriffe/mandant.ts";

export function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    costMicroCentsRem: 0,
    costCorrectionMicroCentsRem: 0,
    ttsCharacters: 0,
    calls: 0,
    spendMonthKey: null,
    spendMonthCostCents: 0,
    budgetPeriodKey: null,
    budgetPeriodBaselineCents: 0,
  };
}

export function emptyPlatformTtsUsage() {
  return { cycleKey: null, characters: 0, warnedCycle: null };
}

export function emptyCostCrossCheck() {
  return { lastCheckedMonthKey: null };
}

export { DEFAULT_GREETING, defaultSettings, demoCalendar };

export function defaultSettingsMap() {
  return { [BOOTSTRAP_TENANT_ID]: defaultSettings() };
}

export function calendarMap() {
  return { [BOOTSTRAP_TENANT_ID]: demoCalendar() };
}

export function emptyUsageMap() {
  return { [BOOTSTRAP_TENANT_ID]: emptyUsage() };
}

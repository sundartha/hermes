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

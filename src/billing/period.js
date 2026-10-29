import { oneMonthBack } from "../utils/month.js";

export const MS_PER_SECOND = 1000;

export function periodStartFromEnd(endSec) {
  return oneMonthBack(new Date(endSec * MS_PER_SECOND));
}

export function resolvePeriodStartIso({ currentPeriodStart, currentPeriodEnd } = {}) {
  if (currentPeriodStart != null)
    return new Date(currentPeriodStart * MS_PER_SECOND).toISOString();
  if (currentPeriodEnd != null) return periodStartFromEnd(currentPeriodEnd).toISOString();
  return null;
}

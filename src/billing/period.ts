import { oneMonthBack } from "../utils/month.js";
import { MS_PER_SECOND } from "../utils/timer.js";

export { MS_PER_SECOND } from "../utils/timer.js";

interface PeriodSeconds {
  currentPeriodStart?: number | null | undefined;
  currentPeriodEnd?: number | null | undefined;
}

export function periodStartFromEnd(endSec: number): Date {
  return oneMonthBack(new Date(endSec * MS_PER_SECOND));
}

export function resolvePeriodStartIso({ currentPeriodStart, currentPeriodEnd }: PeriodSeconds = {}): string | null {
  if (currentPeriodStart != null)
    return new Date(currentPeriodStart * MS_PER_SECOND).toISOString();
  if (currentPeriodEnd != null) return periodStartFromEnd(currentPeriodEnd).toISOString();
  return null;
}

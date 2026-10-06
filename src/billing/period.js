export const MS_PER_SECOND = 1000;

export function periodStartFromEnd(endSec) {
  const start = new Date(endSec * MS_PER_SECOND);
  start.setUTCMonth(start.getUTCMonth() - 1);
  return start;
}

export function resolvePeriodStartIso({ currentPeriodStart, currentPeriodEnd } = {}) {
  if (currentPeriodStart != null)
    return new Date(currentPeriodStart * MS_PER_SECOND).toISOString();
  if (currentPeriodEnd != null) return periodStartFromEnd(currentPeriodEnd).toISOString();
  return null;
}

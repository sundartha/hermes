export const MS_PER_SECOND = 1000;

export function periodStartFromEnd(endSec) {
  const start = new Date(endSec * MS_PER_SECOND);
  const letzterTagVormonat = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 0)).getUTCDate();
  start.setUTCDate(Math.min(start.getUTCDate(), letzterTagVormonat));
  start.setUTCMonth(start.getUTCMonth() - 1);
  return start;
}

export function resolvePeriodStartIso({ currentPeriodStart, currentPeriodEnd } = {}) {
  if (currentPeriodStart != null)
    return new Date(currentPeriodStart * MS_PER_SECOND).toISOString();
  if (currentPeriodEnd != null) return periodStartFromEnd(currentPeriodEnd).toISOString();
  return null;
}

const PERCENT_MIN = 0;
const PERCENT_MAX = 100;
const TENTHS_PER_PERCENT = 10;
const FILL_MIN_VISIBLE_PERCENT = 2;

export function quotaFillPercent(quota) {
  if (!quota || !quota.includedMinutes) return PERCENT_MIN;
  const usedMinutes = quota.includedMinutes - quota.remainingMinutes;
  const usedShare = usedMinutes / quota.includedMinutes;
  const tenths = Math.round(usedShare * PERCENT_MAX * TENTHS_PER_PERCENT);
  const percent = tenths / TENTHS_PER_PERCENT;
  const clamped = Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, percent));
  if (clamped === PERCENT_MIN) return PERCENT_MIN;
  return Math.max(FILL_MIN_VISIBLE_PERCENT, clamped);
}

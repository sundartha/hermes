const FIRST_DAY = 1;
const DAY_BEFORE_FIRST = 0;
const ONE_MONTH = 1;
const MONTH_KEY_DIGITS = 2;

export function yearMonthKey(at) {
  const month = String(at.getUTCMonth() + ONE_MONTH).padStart(MONTH_KEY_DIGITS, "0");
  return `${at.getUTCFullYear()}-${month}`;
}

export function previousMonthStart(at) {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - ONE_MONTH, FIRST_DAY));
}

export function lastDayOfMonth(at) {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + ONE_MONTH, DAY_BEFORE_FIRST));
}

export function oneMonthBack(at) {
  const previous = previousMonthStart(at);
  const day = Math.min(at.getUTCDate(), lastDayOfMonth(previous).getUTCDate());
  const back = new Date(at.getTime());
  back.setUTCFullYear(previous.getUTCFullYear(), previous.getUTCMonth(), day);
  return back;
}

const FIRST_DAY = 1;
const ONE_MONTH = 1;

export function nextMonthStart(at) {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + ONE_MONTH, FIRST_DAY));
}

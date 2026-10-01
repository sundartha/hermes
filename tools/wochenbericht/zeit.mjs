export const DAY_MS = 86_400_000;
const THURSDAY_OFFSET = 3;
const DAYS_PER_WEEK = 7;
export const WEEK_MS = DAYS_PER_WEEK * DAY_MS;
const MONDAY_BASED = 6;
const TIME_ZONE = "Europe/Berlin";

const DATE_FORMAT = new Intl.DateTimeFormat("de-DE", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const MONTH_FORMAT = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, month: "long" });

export function germanDate(date) {
  return DATE_FORMAT.format(new Date(date));
}

export function monthName(date) {
  return MONTH_FORMAT.format(date);
}

export function daysBetween(earlier, later) {
  return Math.floor((new Date(later) - new Date(earlier)) / DAY_MS);
}

export function isoWeek(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = (day.getUTCDay() + MONDAY_BASED) % DAYS_PER_WEEK;
  day.setUTCDate(day.getUTCDate() - weekday + THURSDAY_OFFSET);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return Math.ceil(((day - yearStart) / DAY_MS + 1) / DAYS_PER_WEEK);
}

export function monthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function daysInMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

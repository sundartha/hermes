export const DEFAULT_COUNTRY = "DE";

export const DEFAULT_TIMEZONE = "Europe/Berlin";

export const TIMEZONE_FOR_COUNTRY = Object.freeze({
  DE: "Europe/Berlin", AT: "Europe/Vienna", CH: "Europe/Zurich",
  FR: "Europe/Paris", GB: "Europe/London", IE: "Europe/Dublin",
  US: "America/New_York", CA: "America/Toronto",
});

export function resolveTimezone(timezone) {
  if (typeof timezone !== "string" || !timezone.trim()) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

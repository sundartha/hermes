import { DEFAULT_COUNTRY, DEFAULT_TIMEZONE, TIMEZONE_FOR_COUNTRY } from "../begriffe/sprache-zeit.js";
import { languageForCountry } from "../i18n/locales.ts";

export function normCountry(raw) {
  if (typeof raw !== "string") return null;
  const cc = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

export function resolveOnboardCountry({ userCountry, proposedCountry, fallbackCountry = "" } = {}) {
  return (
    normCountry(userCountry) ?? normCountry(proposedCountry) ?? (fallbackCountry || DEFAULT_COUNTRY)
  );
}

export function timezoneForCountry(country) {
  return TIMEZONE_FOR_COUNTRY[String(country).toUpperCase()] ?? DEFAULT_TIMEZONE;
}

export function tenantGeoForCountry(country) {
  return {
    country,
    defaultLanguage: languageForCountry(country),
    timezone: timezoneForCountry(country),
  };
}

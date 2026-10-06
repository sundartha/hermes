import { DEFAULT_COUNTRY, DEFAULT_TIMEZONE } from "../store/defaults.js";
import { languageForCountry } from "../i18n/locales.js";

export function normCountry(raw) {
  const cc = String(raw || "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

export function resolveOnboardCountry({ userCountry, proposedCountry, fallbackCountry } = {}) {
  return (
    normCountry(userCountry) || normCountry(proposedCountry) || fallbackCountry || DEFAULT_COUNTRY
  );
}

export function resolveNumberCountry(homeCountry, forceNumberCountry) {
  return forceNumberCountry || homeCountry;
}

export const TIMEZONE_FOR_COUNTRY = Object.freeze({
  DE: "Europe/Berlin", AT: "Europe/Vienna", CH: "Europe/Zurich",
  FR: "Europe/Paris", GB: "Europe/London", IE: "Europe/Dublin",
  US: "America/New_York", CA: "America/Toronto",
});

export function timezoneForCountry(country) {
  return TIMEZONE_FOR_COUNTRY[String(country || "").toUpperCase()] || DEFAULT_TIMEZONE;
}

export function tenantGeoForCountry(country) {
  return {
    country,
    defaultLanguage: languageForCountry(country),
    timezone: timezoneForCountry(country),
  };
}

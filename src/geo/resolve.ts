import {
  DEFAULT_COUNTRY,
  DEFAULT_TIMEZONE,
  TIMEZONE_FOR_COUNTRY,
} from "../begriffe/sprache-zeit.ts";
import { languageForCountry } from "../i18n/locales.ts";

export function normCountry(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cc = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

type OnboardCountryEingabe = {
  userCountry?: unknown;
  proposedCountry?: unknown;
  fallbackCountry?: string;
};

export function resolveOnboardCountry({
  userCountry,
  proposedCountry,
  fallbackCountry = "",
}: OnboardCountryEingabe = {}): string {
  return (
    normCountry(userCountry) ?? normCountry(proposedCountry) ?? (fallbackCountry || DEFAULT_COUNTRY)
  );
}

export function timezoneForCountry(country: unknown): string {
  const zeitzonen: Readonly<Record<string, string>> = TIMEZONE_FOR_COUNTRY;
  return zeitzonen[String(country).toUpperCase()] ?? DEFAULT_TIMEZONE;
}

export function tenantGeoForCountry(country: string): {
  country: string;
  defaultLanguage: string;
  timezone: string;
} {
  return {
    country,
    defaultLanguage: languageForCountry(country),
    timezone: timezoneForCountry(country),
  };
}

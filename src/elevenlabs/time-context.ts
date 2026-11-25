import { LOCALES } from "../i18n/locales.ts";
import { countryForE164 } from "../begriffe/rufnummern.js";
import { TIMEZONE_FOR_COUNTRY, resolveTimezone } from "../begriffe/sprache-zeit.ts";
import { timezoneHypothesisForNumber } from "./nanp-area-codes.ts";

const KEINE_ZONE = "";

const DATE_LOCALE = LOCALES.en.dateLocale;
const DATE_FORMAT = Object.freeze({
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const ZONE_JE_LAND: Readonly<Record<string, string>> = TIMEZONE_FOR_COUNTRY;

export function calleeTimezone(e164: string): string {
  const land = countryForE164(e164);
  return (land && ZONE_JE_LAND[land]) ?? KEINE_ZONE;
}

export function todayIn(timeZone: string, jetzt: () => Date): string {
  return new Intl.DateTimeFormat(DATE_LOCALE, { ...DATE_FORMAT, timeZone }).format(jetzt());
}

interface Zeitkontext {
  ownerZone: string;
  calleeZone: string;
  calleeZoneHypothesis: string;
  today: string;
}

export function callTimeContext({
  tenantTimezone,
  callee,
  jetzt,
}: {
  tenantTimezone: unknown;
  callee: string;
  jetzt: () => Date;
}): Zeitkontext {
  const ownerZone = resolveTimezone(tenantTimezone);
  const calleeZone = calleeTimezone(callee);
  return {
    ownerZone,
    calleeZone,
    calleeZoneHypothesis: calleeZone ? KEINE_ZONE : timezoneHypothesisForNumber(callee),
    today: todayIn(ownerZone, jetzt),
  };
}

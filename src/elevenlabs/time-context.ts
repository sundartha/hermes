import { TIMEZONE_FOR_COUNTRY } from "../geo/resolve.js";
import { LOCALES } from "../i18n/locales.js";
import { countryForE164 } from "../begriffe/rufnummern.js";
import { resolveTimezone } from "../begriffe/sprache-zeit.js";
import { timezoneHypothesisForNumber } from "./nanp-area-codes.js";

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

export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat(DATE_LOCALE, { ...DATE_FORMAT, timeZone }).format(new Date());
}

interface Zeitkontext {
  ownerZone: string;
  calleeZone: string;
  calleeZoneHypothesis: string;
  today: string;
}

export function callTimeContext({ tenantTimezone, callee }: { tenantTimezone: unknown; callee: string }): Zeitkontext {
  const ownerZone = resolveTimezone(tenantTimezone);
  const calleeZone = calleeTimezone(callee);
  return {
    ownerZone,
    calleeZone,
    calleeZoneHypothesis: calleeZone ? KEINE_ZONE : timezoneHypothesisForNumber(callee),
    today: todayIn(ownerZone),
  };
}

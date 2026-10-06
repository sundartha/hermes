import { TIMEZONE_FOR_COUNTRY } from "../geo/resolve.js";
import { LOCALES } from "../i18n/locales.js";
import { countryForE164, resolveTimezone } from "../store/defaults.js";
import { timezoneHypothesisForNumber } from "./nanp-area-codes.js";

const KEINE_ZONE = "";

const DATE_LOCALE = LOCALES.en.dateLocale;
const DATE_FORMAT = Object.freeze({
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function calleeTimezone(e164) {
  const land = countryForE164(e164);
  return (land && TIMEZONE_FOR_COUNTRY[land]) || KEINE_ZONE;
}

export function todayIn(timeZone) {
  return new Intl.DateTimeFormat(DATE_LOCALE, { ...DATE_FORMAT, timeZone }).format(new Date());
}

export function callTimeContext({ tenantTimezone, callee }) {
  const ownerZone = resolveTimezone(tenantTimezone);
  const calleeZone = calleeTimezone(callee);
  return {
    ownerZone,
    calleeZone,
    calleeZoneHypothesis: calleeZone ? KEINE_ZONE : timezoneHypothesisForNumber(callee),
    today: todayIn(ownerZone),
  };
}

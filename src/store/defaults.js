import { INBOUND_NOTICES, withInboundNotice } from "../i18n/inbound-notice.js";
import { MANDATE_OUT_OF_SCOPE } from "./begriffe-anrufe.js";
import { emptyUsage } from "./begriffe-leerzustaende.js";
import { BOOTSTRAP_TENANT_ID } from "./begriffe-mandant.js";
import { E164, isNanpCountry, normNum } from "./begriffe-rufnummern.js";

export { NUMBER_STATUS, NUMBER_TRANSITIONS, PROVISIONING_JOB_STATUS } from "./begriffe-nummern.js";
export {
  CONSULT_ANSWER,
  CONSULT_ANSWER_MODE,
  CONSULT_STATUS,
  CONSULT_TIMEOUT_REASON,
  CONSULT_WAIT,
} from "./begriffe-rueckfrage.js";
export {
  BOOTSTRAP_TENANT_ID,
  KYC_LEVEL,
  KYC_ORDER,
  KYC_OUTBOUND_MIN,
  TENANT_STATUS,
  tenantIdForSubject,
} from "./begriffe-mandant.js";
export {
  CENTS_PER_EUR,
  COST_TRUING_SOURCE,
  EUR_DECIMALS,
  MICRO_CENTS_PER_CENT,
  MODEL_PRICE_RATE_FIELDS,
  PROVIDER_RATE_SCALE,
  REIFE,
  REIFE_FORTSCHRITT,
  REIFE_SUMMIERBAR,
  REIFE_TERMINAL,
  RESERVE_LEAD_MINUTES,
  TOKENS_PER_M_TOK,
  USAGE_CORRUPT_REASON,
  USAGE_EVENT_KIND,
  eurText,
  globalCapCents,
  isBookableCents,
  isCorrectionCents,
  isProviderMicroCents,
  istBeweisendeHerkunft,
  outboundReserveCents,
  spendMonthEndDate,
} from "./begriffe-abrechnung.js";
export { E164, isNanpCountry, normNum } from "./begriffe-rufnummern.js";
export { MAX_NOTIFICATIONS, WEBHOOK_ANCHOR_HISTORY } from "./begriffe-speicher.js";
export {
  DEFAULT_PROVIDER,
  GLOBAL_CAP_REASON,
  NEEDS_MANUAL_RECONCILE_REASON,
  NUMBER_HOLD_REASON,
  PLATFORM_NUMBER_PURPOSE,
  PROVIDER,
  PROVISION_NUMBER_JOB,
  REQUEST_NUMBER_REASON,
  resolveSeedProvider,
  shouldPersistProvisionResult,
} from "./begriffe-nummern-vergabe.js";
export {
  KEY_FACTS_LIMITS,
  MANDATE_OUT_OF_SCOPE,
  MANDATE_OUT_OF_SCOPE_DEFAULT,
  MAX_CALL_DURATION_CAP_S,
} from "./begriffe-anrufe.js";
export {
  emptyCostCrossCheck,
  emptyPlatformTtsUsage,
  emptyUsage,
} from "./begriffe-leerzustaende.js";

const DEMO_EVENTS = [
  { id: "ev1", title: "Team-Meeting", daysAhead: 1, startHour: 10, endHour: 11 },
  { id: "ev2", title: "Mittagessen mit Alex", daysAhead: 2, startHour: 12, endHour: 13 },
  { id: "ev3", title: "Projekt-Review", daysAhead: 3, startHour: 15, endHour: 16.5 },
];

export const MANDATE_OUT_OF_SCOPE_VALUES = Object.freeze(Object.values(MANDATE_OUT_OF_SCOPE));

function nextWeekday(daysAhead, hour) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const wholeHours = Math.floor(hour);
  const minutes = (hour % 1) * 60;
  d.setHours(wholeHours, minutes, 0, 0);
  return d.toISOString();
}

export const DEFAULT_GREETING = withInboundNotice(
  "Hallo, hier ist der KI-Assistent von {owner}. {owner} kann gerade nicht ans Telefon. Ich kann eine Nachricht für {owner} aufnehmen. Wie kann ich helfen?",
  INBOUND_NOTICES.de,
);

export const DEFAULT_COUNTRY = "DE";
export let DEFAULT_LANGUAGE = "en";

export function setWorldDefaultLanguageEnabled(enabled) {
  DEFAULT_LANGUAGE = enabled ? "en" : "de";
}

export const DEFAULT_TIMEZONE = "Europe/Berlin";

export function resolveTimezone(timezone) {
  if (typeof timezone !== "string" || !timezone.trim()) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function defaultSettings() {
  return {
    agentName: "Hermes",
    greeting: DEFAULT_GREETING,
    allowCalendar: true,
    allowBooking: true,
    allowSummaries: true,
    smsSummaryOptIn: true,
    allowPersonalData: false,
    allowBankData: false,
    allowResearch: false,
    allowCallMemory: false,
    language: null,
    agentStyle: null,
  };
}

export function demoCalendar() {
  return DEMO_EVENTS.map((demoEvent) => ({
    id: demoEvent.id,
    title: demoEvent.title,
    start: nextWeekday(demoEvent.daysAhead, demoEvent.startHour),
    end: nextWeekday(demoEvent.daysAhead, demoEvent.endHour),
  }));
}

export function defaultSettingsMap() {
  return { [BOOTSTRAP_TENANT_ID]: defaultSettings() };
}

export function calendarMap() {
  return { [BOOTSTRAP_TENANT_ID]: demoCalendar() };
}

export function emptyUsageMap() {
  return { [BOOTSTRAP_TENANT_ID]: emptyUsage() };
}

export const PROFILE_FIELDS = {
  allowedNumbers: "string[]",
  allowedCountryCodes: "string[]",
  unrestricted: "boolean",
  allowCalendar: "boolean",
  allowConsult: "boolean",
  allowLookup: "boolean",
  allowBooking: "boolean",
  maxCallsPerHour: "number?",
};

const TRUNK_ZERO_COUNTRY_CODES = ["+49", "+33", "+44"];
const NATIONAL_TRUNK_PREFIX = "0";

const NANP_COUNTRY_CODE = "+1";
const NANP_INTERNATIONAL_PREFIX = "011";
const NANP_TRUNK_PREFIX = "1";
const NANP_NSN_DIGITS = 10;
const NANP_NATIONAL_DIGITS = NANP_NSN_DIGITS + NANP_TRUNK_PREFIX.length;

const NANP_NSN_PATTERN = /^[2-9]\d{2}[2-9]\d{6}$/;

const DIALING_HOME_COUNTRY_CODES = [...TRUNK_ZERO_COUNTRY_CODES, NANP_COUNTRY_CODE];

const NO_NATIONAL_ELEVEN_RANGE_COUNTRIES = ["+49", "+33"];

export function hasTrunkZeroAfterCountryCode(e164) {
  if (typeof e164 !== "string" || !e164) return false;
  return TRUNK_ZERO_COUNTRY_CODES.some((code) => e164.startsWith(code + NATIONAL_TRUNK_PREFIX));
}

export function homeCountryCode(candidateNumbers, tenantCountryIso = null) {
  for (const num of candidateNumbers) {
    if (typeof num !== "string") continue;
    const code = DIALING_HOME_COUNTRY_CODES.find((dialingCode) => num.startsWith(dialingCode));
    if (!code) continue;
    if (code === NANP_COUNTRY_CODE && !isNanpCountry(tenantCountryIso)) continue;
    return code;
  }
  return null;
}

const INTERNATIONAL_CALL_PREFIX = "00";

function normalizeNanpTarget(raw) {
  const num = normNum(raw);
  if (num.startsWith("+")) return num;
  if (num.startsWith(INTERNATIONAL_CALL_PREFIX))
    return "+" + num.slice(INTERNATIONAL_CALL_PREFIX.length);
  if (num.startsWith(NANP_INTERNATIONAL_PREFIX))
    return "+" + num.slice(NANP_INTERNATIONAL_PREFIX.length);
  if (!/^\d+$/.test(num)) return num;
  if (num.length === NANP_NATIONAL_DIGITS && num.startsWith(NANP_TRUNK_PREFIX)) {
    const nsn = num.slice(NANP_TRUNK_PREFIX.length);
    return NANP_NSN_PATTERN.test(nsn) ? "+" + num : num;
  }
  if (num.length === NANP_NSN_DIGITS) return NANP_NSN_PATTERN.test(num) ? NANP_COUNTRY_CODE + num : num;
  return num;
}

function normalizeTrunkZeroTarget(num, homeCountry) {
  if (num.startsWith(INTERNATIONAL_CALL_PREFIX))
    return "+" + num.slice(INTERNATIONAL_CALL_PREFIX.length);
  if (
    num.startsWith(NANP_INTERNATIONAL_PREFIX) &&
    NO_NATIONAL_ELEVEN_RANGE_COUNTRIES.includes(homeCountry)
  )
    return num;
  if (num.startsWith(NATIONAL_TRUNK_PREFIX) && homeCountry)
    return homeCountry + num.slice(NATIONAL_TRUNK_PREFIX.length);
  return num;
}

export function normalizeDialTarget(num, homeCountry) {
  if (typeof num !== "string") return "";
  if (homeCountry === NANP_COUNTRY_CODE) return normalizeNanpTarget(num);
  return normalizeTrunkZeroTarget(num, homeCountry);
}

const DEFAULT_PRIVATE_NUMBER_CODES = Object.freeze(["+49"]);

const CALLING_CODE_FOR_COUNTRY = Object.freeze({
  DE: "+49", AT: "+43", CH: "+41", FR: "+33", GB: "+44", IE: "+353",
});

export function allowedPrivateNumberCodes(countryIso) {
  const cc = String(countryIso || "").toUpperCase();
  if (isNanpCountry(cc)) return [NANP_COUNTRY_CODE];
  const code = CALLING_CODE_FOR_COUNTRY[cc];
  return code ? [code] : DEFAULT_PRIVATE_NUMBER_CODES;
}

const CALLING_CODES_LONGEST_FIRST = Object.freeze(
  Object.values(CALLING_CODE_FOR_COUNTRY).sort((codeA, codeB) => codeB.length - codeA.length),
);
const COUNTRY_FOR_CALLING_CODE = Object.freeze(
  Object.fromEntries(Object.entries(CALLING_CODE_FOR_COUNTRY).map(([iso, code]) => [code, iso])),
);

export function countryForE164(e164) {
  if (typeof e164 !== "string" || !E164.test(e164)) return null;
  const code = CALLING_CODES_LONGEST_FIRST.find((callingCode) => e164.startsWith(callingCode));
  return code ? COUNTRY_FOR_CALLING_CODE[code] : null;
}

export function countryAllowed(e164, allowedCodes = DEFAULT_PRIVATE_NUMBER_CODES) {
  if (typeof e164 !== "string" || !e164) return false;
  return allowedCodes.includes("*") || allowedCodes.some((prefix) => e164.startsWith(prefix));
}

export function sanitizeProfile(patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch || {})) {
    const type = PROFILE_FIELDS[key];
    if (!type) continue;
    if (type === "string[]") {
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        clean[key] =
          key === "allowedNumbers"
            ? value.map(normNum).filter(Boolean)
            : value.map((c) => c.trim()).filter(Boolean);
      }
    } else if (type === "number?") {
      if (value === null || typeof value === "number") clean[key] = value;
    } else if (typeof value === type) {
      clean[key] = value;
    }
  }
  return clean;
}

const DEFAULT_PROFILE_MAX_CALLS_PER_HOUR = 0;

const OWNER_PROFILE = {
  allowedNumbers: [],
  allowedCountryCodes: [],
  unrestricted: false,
  allowCalendar: true,
  allowConsult: true,
  allowLookup: true,
  allowBooking: true,
  maxCallsPerHour: null,
};

const DEFAULT_PROFILE = {
  allowedNumbers: [],
  allowedCountryCodes: [],
  unrestricted: false,
  allowCalendar: false,
  allowConsult: false,
  allowLookup: false,
  allowBooking: false,
  maxCallsPerHour: DEFAULT_PROFILE_MAX_CALLS_PER_HOUR,
};

export function resolveProfileFrom(tenantId, storedProfile) {
  if (tenantId === BOOTSTRAP_TENANT_ID) return { ...OWNER_PROFILE };
  return storedProfile ? { ...DEFAULT_PROFILE, ...storedProfile } : { ...DEFAULT_PROFILE };
}

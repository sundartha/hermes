import { INBOUND_NOTICES, withInboundNotice } from "../i18n/inbound-notice.js";

export const BOOTSTRAP_TENANT_ID = "owner";

const DEMO_EVENTS = [
  { id: "ev1", title: "Team-Meeting", daysAhead: 1, startHour: 10, endHour: 11 },
  { id: "ev2", title: "Mittagessen mit Alex", daysAhead: 2, startHour: 12, endHour: 13 },
  { id: "ev3", title: "Projekt-Review", daysAhead: 3, startHour: 15, endHour: 16.5 },
];

export const MAX_NOTIFICATIONS = 50;

export const WEBHOOK_ANCHOR_HISTORY = 6;

export const PROVIDER = Object.freeze({ TELNYX: "telnyx" });
export const DEFAULT_PROVIDER = PROVIDER.TELNYX;

export function resolveSeedProvider(providerRaw) {
  if (!providerRaw) return DEFAULT_PROVIDER;
  return Object.values(PROVIDER).includes(providerRaw) ? providerRaw : null;
}

export const NUMBER_STATUS = Object.freeze({
  REQUESTED: "requested",
  PROVISIONING: "provisioning",
  CAPTURING: "capturing",
  ACTIVE: "active",
  FAILED: "failed",
  SUSPENDED: "suspended",
  RELEASED: "released",
});

export const NUMBER_TRANSITIONS = Object.freeze({
  [NUMBER_STATUS.REQUESTED]: [NUMBER_STATUS.PROVISIONING, NUMBER_STATUS.FAILED],
  [NUMBER_STATUS.PROVISIONING]: [
    NUMBER_STATUS.CAPTURING,
    NUMBER_STATUS.ACTIVE,
    NUMBER_STATUS.FAILED,
  ],
  [NUMBER_STATUS.CAPTURING]: [NUMBER_STATUS.ACTIVE, NUMBER_STATUS.FAILED],
  [NUMBER_STATUS.ACTIVE]: [NUMBER_STATUS.SUSPENDED, NUMBER_STATUS.RELEASED],
  [NUMBER_STATUS.SUSPENDED]: [NUMBER_STATUS.ACTIVE, NUMBER_STATUS.RELEASED],
  [NUMBER_STATUS.FAILED]: [NUMBER_STATUS.RELEASED],
  [NUMBER_STATUS.RELEASED]: [],
});

export const PLATFORM_NUMBER_PURPOSE = Object.freeze({
  OUTBOUND_ANI: "outbound_ani",
  ALERT_SMS_SENDER: "alert_sms_sender",
});

export const NUMBER_HOLD_REASON = Object.freeze({
  PLATFORM_IN_USE: "platform_number_in_use",
  ACTIVE_CALL: "active_call_on_number",
  NON_TELNYX: "non_telnyx_manual",
});

export const GLOBAL_CAP_REASON = "global_cap";

export const NEEDS_MANUAL_RECONCILE_REASON = "needs_manual_reconcile";

export const REQUEST_NUMBER_REASON = Object.freeze({
  TENANT_INACTIVE: "tenant_inactive",
  TENANT_CAP: "tenant_cap",
  GLOBAL_CAP: GLOBAL_CAP_REASON,
});

export function shouldPersistProvisionResult(r) {
  return r.ok || r.reason === GLOBAL_CAP_REASON;
}

export const PROVISIONING_JOB_STATUS = Object.freeze({
  QUEUED: "queued",
  DONE: "done",
  FAILED: "failed",
});
export const PROVISION_NUMBER_JOB = "provision_number";

export const USAGE_EVENT_KIND = Object.freeze({
  VOICE_MINUTE: "voice_minute",
  AI_TOKEN: "ai_token",
  SMS: "sms",
  NUMBER_MONTH: "number_month",
});

export const COST_TRUING_SOURCE = Object.freeze({
  DETAIL_RECORDS: "telnyx_detail_records",
  KOSTENBUCH_VOLLBELEG: "kostenbuch_vollbeleg",
  KOSTENBUCH_TEILBELEG: "kostenbuch_teilbeleg",
  INCOMPLETE: "incomplete",
  NO_ESTIMATE: "no_estimate",
  UNAVAILABLE: "unavailable",
});

const BEWEISENDE_HERKUNFT = Object.freeze([
  COST_TRUING_SOURCE.DETAIL_RECORDS,
  COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG,
]);

export function istBeweisendeHerkunft(source) {
  return BEWEISENDE_HERKUNFT.includes(source);
}

export const REIFE = Object.freeze({
  ERWARTET: "erwartet",
  VORLAEUFIG: "vorlaeufig",
  BELEGT: "belegt",
  STRUKTURELL_UNBESCHAFFBAR: "beleg_strukturell_unbeschaffbar",
});

export const REIFE_FORTSCHRITT = Object.freeze([REIFE.ERWARTET, REIFE.VORLAEUFIG, REIFE.BELEGT]);

export const REIFE_TERMINAL = Object.freeze([REIFE.STRUKTURELL_UNBESCHAFFBAR]);

export const REIFE_SUMMIERBAR = Object.freeze([REIFE.VORLAEUFIG, REIFE.BELEGT]);

export const CENTS_PER_EUR = 100;

export const EUR_DECIMALS = 2;

export function eurText(cents) {
  return (cents / CENTS_PER_EUR).toFixed(EUR_DECIMALS);
}

const ISO_DATE_LENGTH = 10;

export function spendMonthEndDate(nowMs) {
  const at = new Date(nowMs);
  const lastDayOfMonth = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0));
  return lastDayOfMonth.toISOString().slice(0, ISO_DATE_LENGTH);
}

export const MICRO_CENTS_PER_CENT = 1_000_000;

export const USAGE_CORRUPT_REASON = "usage_korrupt";

export function isBookableCents(x) {
  return Number.isFinite(x) && Number.isInteger(x) && x >= 0;
}

export const PROVIDER_RATE_SCALE = 1_000_000;

export function isCorrectionCents(x) {
  return Number.isFinite(x) && Number.isInteger(x);
}

export function isProviderMicroCents(wert) {
  return Number.isSafeInteger(wert) && wert >= 0;
}

export const TOKENS_PER_M_TOK = 1_000_000;

export const MODEL_PRICE_RATE_FIELDS = Object.freeze([
  "inPerMTok",
  "cacheWritePerMTok",
  "cacheReadPerMTok",
  "outPerMTok",
]);

export function globalCapCents(cfg) {
  return cfg.platformSpendCapCents;
}

export const MAX_CALL_DURATION_CAP_S = 1800;

export const RESERVE_LEAD_MINUTES = 2;

export function outboundReserveCents(tariffCentsPerMin) {
  return tariffCentsPerMin * RESERVE_LEAD_MINUTES;
}

export const MANDATE_OUT_OF_SCOPE = Object.freeze({
  TAKE_MESSAGE: "take_message",
  DECLINE: "decline",
  ACCEPT_BEST: "accept_best",
});
export const MANDATE_OUT_OF_SCOPE_VALUES = Object.freeze(Object.values(MANDATE_OUT_OF_SCOPE));

export const KEY_FACTS_LIMITS = Object.freeze({ maxItems: 10, maxLen: 200 });

export const CONSULT_STATUS = Object.freeze({
  OPEN: "open",
  ANSWERED: "answered",
  EXPIRED: "expired",
  TIMED_OUT: "timed_out",
});

export const CONSULT_WAIT = Object.freeze({
  NONE: "none",
  HOLD: "hold",
  PENDING: "pending",
  TIMED_OUT: "timed_out",
  ANSWERED: "answered",
});

export const CONSULT_ANSWER = Object.freeze({
  ACCEPTED: "accepted",
  UNKNOWN_EVENT: "unknown_event",
  ALREADY_ANSWERED: "already_answered",
  CALL_ENDED: "call_ended",
  DEADLINE_PASSED: "deadline_passed",
});

export const CONSULT_TIMEOUT_REASON = Object.freeze({
  NOT_DELIVERED: "not_delivered",
  NOT_ACKED: "not_acked",
  TIMEOUT: "timeout",
});

export const CONSULT_ANSWER_MODE = Object.freeze({ WORKING: "working", FINAL: "final" });

export const MANDATE_OUT_OF_SCOPE_DEFAULT = MANDATE_OUT_OF_SCOPE.TAKE_MESSAGE;

export const TENANT_STATUS = Object.freeze({
  ACTIVE: "active",
  SUSPENDED: "suspended",
  CLOSED: "closed",
});

const TENANT_ID_PREFIX = "t_";
export const tenantIdForSubject = (sub) => `${TENANT_ID_PREFIX}${sub}`;

export const KYC_LEVEL = Object.freeze({
  NONE: "none",
  OTP: "otp",
  CARD: "card",
  ID_VERIFIED: "id_verified",
});
export const KYC_ORDER = Object.freeze([
  KYC_LEVEL.NONE,
  KYC_LEVEL.OTP,
  KYC_LEVEL.CARD,
  KYC_LEVEL.ID_VERIFIED,
]);

export const KYC_OUTBOUND_MIN = KYC_LEVEL.CARD;

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
  return DEMO_EVENTS.map((e) => ({
    id: e.id,
    title: e.title,
    start: nextWeekday(e.daysAhead, e.startHour),
    end: nextWeekday(e.daysAhead, e.endHour),
  }));
}

export function defaultSettingsMap() {
  return { [BOOTSTRAP_TENANT_ID]: defaultSettings() };
}

export function calendarMap() {
  return { [BOOTSTRAP_TENANT_ID]: demoCalendar() };
}

export function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    costMicroCentsRem: 0,
    costCorrectionMicroCentsRem: 0,
    ttsCharacters: 0,
    calls: 0,
    spendMonthKey: null,
    spendMonthCostCents: 0,
    budgetPeriodKey: null,
    budgetPeriodBaselineCents: 0,
  };
}

export function emptyUsageMap() {
  return { [BOOTSTRAP_TENANT_ID]: emptyUsage() };
}

export function emptyPlatformTtsUsage() {
  return { cycleKey: null, characters: 0, warnedCycle: null };
}

export function emptyCostCrossCheck() {
  return { lastCheckedMonthKey: null };
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

export function normNum(n) {
  return typeof n === "string" ? n.replace(/[\s\-()]/g, "") : "";
}

export const E164 = /^\+[1-9]\d{6,14}$/;

const TRUNK_ZERO_COUNTRY_CODES = ["+49", "+33", "+44"];
const NATIONAL_TRUNK_PREFIX = "0";

const NANP_COUNTRY_CODE = "+1";
const NANP_INTERNATIONAL_PREFIX = "011";
const NANP_TRUNK_PREFIX = "1";
const NANP_NSN_DIGITS = 10;
const NANP_NATIONAL_DIGITS = NANP_NSN_DIGITS + NANP_TRUNK_PREFIX.length;

const NANP_NSN_PATTERN = /^[2-9]\d{2}[2-9]\d{6}$/;

const DIALING_HOME_COUNTRY_CODES = [...TRUNK_ZERO_COUNTRY_CODES, NANP_COUNTRY_CODE];

const NANP_ISO_COUNTRIES = Object.freeze([
  "US", "CA", "AG", "AI", "AS", "BB", "BM", "BS", "DM", "DO", "GD", "GU", "JM", "KN",
  "KY", "LC", "MP", "MS", "PR", "SX", "TC", "TT", "VC", "VG", "VI",
]);

export function isNanpCountry(countryIso) {
  return typeof countryIso === "string" && NANP_ISO_COUNTRIES.includes(countryIso.toUpperCase());
}

const NO_NATIONAL_ELEVEN_RANGE_COUNTRIES = ["+49", "+33"];

export function hasTrunkZeroAfterCountryCode(e164) {
  if (typeof e164 !== "string" || !e164) return false;
  return TRUNK_ZERO_COUNTRY_CODES.some((code) => e164.startsWith(code + NATIONAL_TRUNK_PREFIX));
}

export function homeCountryCode(candidateNumbers, tenantCountryIso = null) {
  for (const num of candidateNumbers) {
    if (typeof num !== "string") continue;
    const code = DIALING_HOME_COUNTRY_CODES.find((c) => num.startsWith(c));
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
  Object.values(CALLING_CODE_FOR_COUNTRY).sort((a, b) => b.length - a.length),
);
const COUNTRY_FOR_CALLING_CODE = Object.freeze(
  Object.fromEntries(Object.entries(CALLING_CODE_FOR_COUNTRY).map(([iso, code]) => [code, iso])),
);

export function countryForE164(e164) {
  if (typeof e164 !== "string" || !E164.test(e164)) return null;
  const code = CALLING_CODES_LONGEST_FIRST.find((c) => e164.startsWith(c));
  return code ? COUNTRY_FOR_CALLING_CODE[code] : null;
}

export function countryAllowed(e164, allowedCodes = DEFAULT_PRIVATE_NUMBER_CODES) {
  if (typeof e164 !== "string" || !e164) return false;
  return allowedCodes.includes("*") || allowedCodes.some((c) => e164.startsWith(c));
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

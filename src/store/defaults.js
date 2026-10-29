import { INBOUND_NOTICES, withInboundNotice } from "../i18n/inbound-notice.js";
import { emptyUsage } from "./begriffe-leerzustaende.js";
import { BOOTSTRAP_TENANT_ID } from "./begriffe-mandant.js";

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
export {
  E164,
  allowedPrivateNumberCodes,
  countryAllowed,
  countryForE164,
  hasTrunkZeroAfterCountryCode,
  homeCountryCode,
  isNanpCountry,
  normNum,
  normalizeDialTarget,
} from "./begriffe-rufnummern.js";
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
  MANDATE_OUT_OF_SCOPE_VALUES,
  MAX_CALL_DURATION_CAP_S,
} from "./begriffe-anrufe.js";
export {
  emptyCostCrossCheck,
  emptyPlatformTtsUsage,
  emptyUsage,
} from "./begriffe-leerzustaende.js";
export { DEFAULT_COUNTRY, DEFAULT_TIMEZONE, resolveTimezone } from "./begriffe-sprache-zeit.js";
export { PROFILE_FIELDS, resolveProfileFrom, sanitizeProfile } from "./begriffe-profil.js";

const DEMO_EVENTS = [
  { id: "ev1", title: "Team-Meeting", daysAhead: 1, startHour: 10, endHour: 11 },
  { id: "ev2", title: "Mittagessen mit Alex", daysAhead: 2, startHour: 12, endHour: 13 },
  { id: "ev3", title: "Projekt-Review", daysAhead: 3, startHour: 15, endHour: 16.5 },
];

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

export let DEFAULT_LANGUAGE = "en";

export function setWorldDefaultLanguageEnabled(enabled) {
  DEFAULT_LANGUAGE = enabled ? "en" : "de";
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

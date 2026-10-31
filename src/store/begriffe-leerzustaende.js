import { INBOUND_NOTICES, withInboundNotice } from "../i18n/inbound-notice.js";
import { BOOTSTRAP_TENANT_ID } from "./begriffe-mandant.js";

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

export function emptyPlatformTtsUsage() {
  return { cycleKey: null, characters: 0, warnedCycle: null };
}

export function emptyCostCrossCheck() {
  return { lastCheckedMonthKey: null };
}

const MINUTES_PER_HOUR = 60;

const DEMO_EVENTS = [
  { id: "ev1", title: "Team-Meeting", daysAhead: 1, startHour: 10, endHour: 11 },
  { id: "ev2", title: "Mittagessen mit Alex", daysAhead: 2, startHour: 12, endHour: 13 },
  { id: "ev3", title: "Projekt-Review", daysAhead: 3, startHour: 15, endHour: 16.5 },
];

export const DEFAULT_GREETING = withInboundNotice(
  "Hallo, hier ist der KI-Assistent von {owner}. {owner} kann gerade nicht ans Telefon. Ich kann eine Nachricht für {owner} aufnehmen. Wie kann ich helfen?",
  INBOUND_NOTICES.de,
);

function nextWeekday(daysAhead, hour) {
  const day = new Date();
  day.setDate(day.getDate() + daysAhead);
  const wholeHours = Math.floor(hour);
  const minutes = (hour % 1) * MINUTES_PER_HOUR;
  day.setHours(wholeHours, minutes, 0, 0);
  return day.toISOString();
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

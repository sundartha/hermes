import { NUMBER_STATUS } from "../begriffe/nummern.js";
import { GLOBAL_CAP_REASON } from "../begriffe/nummern-vergabe.js";
import { findTenant, resolveCallLanguage, ersatzZuAlterNummer } from "./state-ops.js";
import { omitKeys } from "../utils/object.ts";

interface Nummer {
  id?: string;
  tenantId: string;
  status: string;
  provider?: string;
  e164: string;
}

export interface NummernZustand {
  numbers: Nummer[];
}

interface Kalender {
  getCalendar: (tenantId: string) => { end: string }[];
}

const mandantVon: (state: NummernZustand, tenantId: string) => { numberProvisionSkipReason?: string } | undefined =
  findTenant;

const anrufSprache: (state: NummernZustand, suche: { tenantId: string; numberRecord: Nummer | undefined }) => string =
  resolveCallLanguage;

const ersatzNummernVon: (state: NummernZustand) => Map<string | undefined, string> = ersatzZuAlterNummer;

const CALL_FIELDS_HIDDEN_FROM_VIEW = [
  "streamToken",
  "_finished",
  "summarySmsSentAt",
  "summaryMailSentAt",
  "notPlacedMailSentAt",
  "bridgedAt",
  "elCallControlId",
  "telnyxConversationId",
  "callerTurns",
  "estimatedCostCents",
  "estimatedCostSpendMonthKey",
  "estimatedCostPeriodKey",
  "actualCostMicroCents",
  "costTruedAt",
  "costTruedSource",
  "costTruingAttempts",
  "inboxEntryAt",
  "inboxSeenAt",
  "fromRegistrationSource",
  "costProfile",
  "elDetectorCounts",
  "webhookAnchors",
  "elBoundAt",
  "elFallbackAt",
  "elNachlaufStartedAt",
  "instanz",
];

export function publicCall(call: Record<string, unknown>): Record<string, unknown> {
  return omitKeys(call, CALL_FIELDS_HIDDEN_FROM_VIEW);
}

export function findActiveNumber(state: NummernZustand, tenantId: string, provider?: string): Nummer | undefined {
  const passt = (number: Nummer) =>
    number.tenantId === tenantId &&
    number.status === NUMBER_STATUS.ACTIVE &&
    (provider === undefined || number.provider === provider);
  const ersatzNummern = ersatzNummernVon(state);
  return (
    state.numbers.find((number: Nummer) => ersatzNummern.has(number.id) && passt(number)) ??
    state.numbers.find(passt)
  );
}

export function tenantLanguage(state: NummernZustand, tenantId: string): string {
  return anrufSprache(state, { tenantId, numberRecord: findActiveNumber(state, tenantId) });
}

export function hasActiveNumber(state: NummernZustand): boolean {
  return state.numbers.some((number) => number.status === NUMBER_STATUS.ACTIVE);
}

export function countActiveNumbers(state: NummernZustand): number {
  return state.numbers.filter((number) => number.status === NUMBER_STATUS.ACTIVE).length;
}

export function activeNumberFor(state: NummernZustand, tenantId: string): string {
  const hit = findActiveNumber(state, tenantId);
  return hit ? hit.e164 : "";
}

export const NUMBER_DISPLAY_STATUS = Object.freeze({
  ACTIVE: "active",
  PROVISIONING: "provisioning",
  REQUESTED: "requested",
  FAILED: "failed",
  BLOCKED: "blocked",
  NONE: "none",
});

export function numberStatusFor(state: NummernZustand, tenantId: string): string {
  const own = state.numbers.filter((number) => number.tenantId === tenantId);
  if (own.some((number) => number.status === NUMBER_STATUS.ACTIVE)) return NUMBER_DISPLAY_STATUS.ACTIVE;
  if (own.some((number) => number.status === NUMBER_STATUS.PROVISIONING || number.status === NUMBER_STATUS.CAPTURING))
    return NUMBER_DISPLAY_STATUS.PROVISIONING;
  if (own.some((number) => number.status === NUMBER_STATUS.REQUESTED)) return NUMBER_DISPLAY_STATUS.REQUESTED;
  if (own.some((number) => number.status === NUMBER_STATUS.FAILED)) return NUMBER_DISPLAY_STATUS.FAILED;
  if (mandantVon(state, tenantId)?.numberProvisionSkipReason === GLOBAL_CAP_REASON)
    return NUMBER_DISPLAY_STATUS.BLOCKED;
  return NUMBER_DISPLAY_STATUS.NONE;
}

export function upcomingCalendar(store: Kalender, tenantId: string): { end: string }[] {
  return store.getCalendar(tenantId).filter((event) => event.end >= new Date().toISOString());
}

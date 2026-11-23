import { NUMBER_STATUS } from "../begriffe/nummern.js";
import { GLOBAL_CAP_REASON } from "../begriffe/nummern-vergabe.js";
import { findTenant, resolveCallLanguage, ersatzZuAlterNummer } from "./state-ops.js";
import { omitKeys } from "../utils/object.ts";
import type { MandantZustand } from "./zustand/mandant.ts";

interface Nummer {
  id: string;
  tenantId: string;
  e164: string | null;
  status: string;
  provider?: string;
  language?: string | null;
}

export type Zustand = Omit<MandantZustand, "numbers"> & { numbers: Nummer[] } & Parameters<
    typeof ersatzZuAlterNummer
  >[0];

export interface AnrufSicht {
  elDetectorCounts?: { stimmenAnzahl?: unknown } | null;
  [feld: string]: unknown;
}

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

export function publicCall(call: AnrufSicht): Record<string, unknown> {
  const sicht = omitKeys(call, CALL_FIELDS_HIDDEN_FROM_VIEW);
  const stimmenAnzahl = call.elDetectorCounts?.stimmenAnzahl;
  return Number.isInteger(stimmenAnzahl) ? { ...sicht, stimmenAnzahl } : sicht;
}

export function findActiveNumber(
  state: Zustand,
  tenantId: string,
  provider?: string,
): Nummer | undefined {
  const passt = (number: Nummer) =>
    number.tenantId === tenantId &&
    number.status === NUMBER_STATUS.ACTIVE &&
    (provider === undefined || number.provider === provider);
  const ersatzNummern: ReadonlyMap<string | undefined, string> = ersatzZuAlterNummer(state);
  return (
    state.numbers.find(
      (number: Nummer | null | undefined) =>
        ersatzNummern.has(number?.id) && number != null && passt(number),
    ) ?? state.numbers.find(passt)
  );
}

export function tenantLanguage(state: Zustand, tenantId: string): string {
  return resolveCallLanguage(state, { tenantId, numberRecord: findActiveNumber(state, tenantId) });
}

export function hasActiveNumber(state: Zustand): boolean {
  return state.numbers.some((number) => number.status === NUMBER_STATUS.ACTIVE);
}

export function countActiveNumbers(state: Zustand): number {
  return state.numbers.filter((number) => number.status === NUMBER_STATUS.ACTIVE).length;
}

export function activeNumberFor(state: Zustand, tenantId: string): string | null {
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

export function numberStatusFor(state: Zustand, tenantId: string): string {
  const own = state.numbers.filter((number) => number.tenantId === tenantId);
  if (own.some((number) => number.status === NUMBER_STATUS.ACTIVE))
    return NUMBER_DISPLAY_STATUS.ACTIVE;
  if (
    own.some(
      (number) =>
        number.status === NUMBER_STATUS.PROVISIONING || number.status === NUMBER_STATUS.CAPTURING,
    )
  )
    return NUMBER_DISPLAY_STATUS.PROVISIONING;
  if (own.some((number) => number.status === NUMBER_STATUS.REQUESTED))
    return NUMBER_DISPLAY_STATUS.REQUESTED;
  if (own.some((number) => number.status === NUMBER_STATUS.FAILED))
    return NUMBER_DISPLAY_STATUS.FAILED;
  if (findTenant(state, tenantId)?.numberProvisionSkipReason === GLOBAL_CAP_REASON)
    return NUMBER_DISPLAY_STATUS.BLOCKED;
  return NUMBER_DISPLAY_STATUS.NONE;
}

export async function upcomingCalendar(
  store: { getCalendar: (tenantId: string) => { end: string }[] | Promise<{ end: string }[]> },
  tenantId: string,
): Promise<{ end: string }[]> {
  return (await store.getCalendar(tenantId)).filter((event) => event.end >= new Date().toISOString());
}

import { calleeIsOwner } from "./callee-is-owner.ts";

interface Datenschutz {
  diagnosticRetentionDays: number;
}

export function diagnosticRetentionEnabled(privacy: Datenschutz): boolean {
  return privacy.diagnosticRetentionDays > 0;
}

const DECLINE_VALUES = new Set<unknown>([false, "false"]);

function callerDeclined(requested: unknown): boolean {
  return DECLINE_VALUES.has(requested);
}

export function diagnosticRetentionGranted({
  requested,
  to,
  ownNumber,
  privacy,
}: {
  requested: unknown;
  to: unknown;
  ownNumber: unknown;
  privacy: Datenschutz;
}): boolean {
  if (callerDeclined(requested)) return false;
  if (!diagnosticRetentionEnabled(privacy)) return false;
  return calleeIsOwner({ to, ownNumber });
}

export function keepsTranscriptForDiagnosis(call: { diagnostic?: unknown }, privacy: Datenschutz): boolean {
  return call.diagnostic === true && diagnosticRetentionEnabled(privacy);
}

const MIN_TURNS_FOR_CUSTOMER_TRANSCRIPT = 2;

export function keepsTranscriptForCustomer({
  call,
  settings,
  privacy,
  summaryCreated,
}: {
  call: { status?: unknown; tenantId?: unknown; transcript: unknown[] };
  settings: { allowSummaries?: unknown };
  privacy: { retentionDays?: number };
  summaryCreated: boolean;
}): boolean {
  return (
    call.status === "completed" &&
    call.transcript.length >= MIN_TURNS_FOR_CUSTOMER_TRANSCRIPT &&
    summaryCreated &&
    Boolean(call.tenantId) &&
    settings.allowSummaries === true &&
    (privacy.retentionDays ?? 0) > 0
  );
}

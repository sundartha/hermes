import { calleeIsOwner } from "./callee-is-owner.js";

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

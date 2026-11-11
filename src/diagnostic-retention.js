import { calleeIsOwner } from "./callee-is-owner.js";

export function diagnosticRetentionEnabled(privacy) {
  return privacy.diagnosticRetentionDays > 0;
}

const DECLINE_VALUES = new Set([false, "false"]);

export function callerDeclined(requested) {
  return DECLINE_VALUES.has(requested);
}

export function diagnosticRetentionGranted({ requested, to, ownNumber, privacy }) {
  if (callerDeclined(requested)) return false;
  if (!diagnosticRetentionEnabled(privacy)) return false;
  return calleeIsOwner({ to, ownNumber });
}

export function keepsTranscriptForDiagnosis(call, privacy) {
  return call.diagnostic === true && call.transcriptDeclined !== true && diagnosticRetentionEnabled(privacy);
}

export function keepsTranscriptForCustomer({ call, settings, privacy, settingsCurrent = true }) {
  if (!settingsCurrent || call.transcriptDeclined === true) return false;
  return settings?.allowSummaries === true && privacy.retentionDays > 0;
}

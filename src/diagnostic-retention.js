import { calleeIsOwner } from "./callee-is-owner.js";

export function diagnosticRetentionEnabled(privacy) {
  return privacy.diagnosticRetentionDays > 0;
}

const DECLINE_VALUES = new Set([false, "false"]);

function callerDeclined(requested) {
  return DECLINE_VALUES.has(requested);
}

export function diagnosticRetentionGranted({ requested, to, ownNumber, privacy }) {
  if (callerDeclined(requested)) return false;
  if (!diagnosticRetentionEnabled(privacy)) return false;
  return calleeIsOwner({ to, ownNumber });
}

export function keepsTranscriptForDiagnosis(call, privacy) {
  return call.diagnostic === true && diagnosticRetentionEnabled(privacy);
}

import { classifyCallTime } from "../store/state-ops.js";

const inFlightByCallId = new Map();

export function reattachActiveCall(callId, deps) {
  const inFlight = inFlightByCallId.get(callId);
  if (inFlight) return inFlight;
  const attempt = runReattach(callId, deps).finally(() => {
    inFlightByCallId.delete(callId);
  });
  inFlightByCallId.set(callId, attempt);
  return attempt;
}

async function runReattach(
  callId,
  {
    attachActiveCall,
    maxCallDurationS,
    terminateCappedCall,
    scheduleMaxDurationEnd,
    budgetAxisFor,
    terminateOverBudgetCall,
  },
) {
  const call = await attachActiveCall(callId);
  if (!call || call.status !== "active") return { call: null, logUnknown: true };
  const { remaining, expired } = classifyCallTime(call, Date.now(), maxCallDurationS);
  if (expired) {
    await terminateCappedCall(call.id, call.twilioSid, "failed");
    return { call: null, logUnknown: false };
  }
  if (budgetAxisFor(call)) {
    await terminateOverBudgetCall(call.id, call.twilioSid);
    return { call: null, logUnknown: false };
  }
  scheduleMaxDurationEnd(call, call.twilioSid, remaining);
  return { call };
}

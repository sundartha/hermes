import { classifyCallTime } from "../store/state-ops.js";
import { makeKeyedSingleFlight } from "../single-flight.js";

export const reattachActiveCall = makeKeyedSingleFlight(runReattach);

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

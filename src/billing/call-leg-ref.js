export function legRefOfCall(call) {
  return call.twilioSid || call.callControlId || call.sipCallId || null;
}

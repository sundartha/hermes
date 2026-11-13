interface Anrufbein {
  twilioSid?: string | null;
  callControlId?: string | null;
  sipCallId?: string | null;
}

export function legRefOfCall(call: Anrufbein): string | null {
  return [call.twilioSid, call.callControlId, call.sipCallId].find(Boolean) ?? null;
}

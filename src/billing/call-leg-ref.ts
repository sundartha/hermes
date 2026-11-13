interface Anrufbein {
  twilioSid?: string | null | undefined;
  callControlId?: string | null | undefined;
  sipCallId?: string | null | undefined;
}

export function legRefOfCall(call: Anrufbein): string | null {
  return [call.twilioSid, call.callControlId, call.sipCallId].find(Boolean) ?? null;
}

const WEG_UNBEKANNT = "unbekannt";
const WEG_NACH_PRAEFIX: readonly (readonly [string, string])[] = Object.freeze([
  ["SCL_", "livekit"],
  ["otb_", "sipgo"],
]);
const MAX_PRAEFIX_ZEICHEN = 8;

type Gespraech = { metadata?: { phone_call?: { call_sid?: unknown; phone_number_id?: unknown } } } | null | undefined;

function phoneCallVon(conversation: Gespraech): { callSid: string; phoneNumberId: unknown } | null {
  const phoneCall = conversation?.metadata?.phone_call;
  if (typeof phoneCall?.call_sid !== "string" || phoneCall.call_sid === "") return null;
  return { callSid: phoneCall.call_sid, phoneNumberId: phoneCall.phone_number_id };
}

function wegVon(callSid: string): string {
  const treffer = WEG_NACH_PRAEFIX.find(([praefix]) => callSid.startsWith(praefix));
  return treffer ? treffer[1] : WEG_UNBEKANNT;
}

export function medienwegAus(conversation: Gespraech): string | null {
  const phoneCall = phoneCallVon(conversation);
  return phoneCall === null ? null : wegVon(phoneCall.callSid);
}

function praefixVon(callSid: string): string {
  const ende = callSid.indexOf("_");
  const vorUnterstrich = ende === -1 ? callSid : callSid.slice(0, ende);
  return vorUnterstrich.replaceAll(/[^A-Za-z0-9]/g, "").slice(0, MAX_PRAEFIX_ZEICHEN);
}

export function medienwegZeilen({ conversation, callId, conversationId, erwartet }: {
  conversation: Gespraech;
  callId: unknown;
  conversationId: unknown;
  erwartet?: string | null;
}): { info: string; abweichung: string | null } | null {
  const phoneCall = phoneCallVon(conversation);
  if (phoneCall === null) return null;
  const weg = wegVon(phoneCall.callSid);
  const bezug = `callId=${callId} conversationId=${conversationId} weg=${weg}`;
  const info = `[el-medienweg] ${bezug} call_sid_praefix=${praefixVon(phoneCall.callSid)} phone_number_id=${phoneCall.phoneNumberId ?? WEG_UNBEKANNT}`;
  const abweichung = erwartet && weg !== erwartet ? `[el-medienweg-abweichung] ${bezug} erwartet=${erwartet}` : null;
  return { info, abweichung };
}

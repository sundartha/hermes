const WEG_UNBEKANNT = "unbekannt";
const WEG_NACH_PRAEFIX = Object.freeze([
  ["SCL_", "livekit"],
  ["otb_", "sipgo"],
]);
const MAX_PRAEFIX_ZEICHEN = 8;

function phoneCallVon(conversation) {
  const phoneCall = conversation?.metadata?.phone_call;
  return typeof phoneCall?.call_sid === "string" && phoneCall.call_sid !== "" ? phoneCall : null;
}

export function medienwegAus(conversation) {
  const phoneCall = phoneCallVon(conversation);
  if (phoneCall === null) return null;
  const treffer = WEG_NACH_PRAEFIX.find(([praefix]) => phoneCall.call_sid.startsWith(praefix));
  return treffer ? treffer[1] : WEG_UNBEKANNT;
}

function praefixVon(callSid) {
  const [vorUnterstrich] = callSid.split("_", 1);
  return vorUnterstrich.replaceAll(/[^A-Za-z0-9]/g, "").slice(0, MAX_PRAEFIX_ZEICHEN);
}

export function medienwegZeilen({ conversation, callId, conversationId, erwartet }) {
  const weg = medienwegAus(conversation);
  if (weg === null) return null;
  const phoneCall = phoneCallVon(conversation);
  const bezug = `callId=${callId} conversationId=${conversationId} weg=${weg}`;
  const info = `[el-medienweg] ${bezug} call_sid_praefix=${praefixVon(phoneCall.call_sid)} phone_number_id=${phoneCall.phone_number_id ?? WEG_UNBEKANNT}`;
  const abweichung = erwartet && weg !== erwartet ? `[el-medienweg-abweichung] ${bezug} erwartet=${erwartet}` : null;
  return { info, abweichung };
}

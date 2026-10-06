const TELNYX_SIP_CALL_ID_PREFIX = "otb_";

const TELNYX_SIP_CALL_ID_MIN_RUMPF_LEN = 8;

export function isTelnyxSipCallId(wert) {
  if (typeof wert !== "string") return false;
  if (!wert.toLowerCase().startsWith(TELNYX_SIP_CALL_ID_PREFIX)) return false;
  return wert.length - TELNYX_SIP_CALL_ID_PREFIX.length >= TELNYX_SIP_CALL_ID_MIN_RUMPF_LEN;
}

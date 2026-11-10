import { z } from "zod";
import { parseSpeakEvent } from "./speak-events.js";
import { parseAnsweredBy } from "../../answered-by.js";
import { CALL_CONTROL_EREIGNIS } from "../../call-control-ereignis.js";

const EREIGNIS_VON_TYP = Object.freeze({
  "call.answered": CALL_CONTROL_EREIGNIS.ABGEHOBEN,
  "call.hangup": CALL_CONTROL_EREIGNIS.AUFGELEGT,
  "call.playback.ended": CALL_CONTROL_EREIGNIS.WIEDERGABE_ENDE,
});

export function parseCallControlEvent(body) {
  const data = body?.data;
  return {
    ereignis: Object.hasOwn(EREIGNIS_VON_TYP, data?.event_type) ? EREIGNIS_VON_TYP[data.event_type] : null,
    callControlId: data?.payload?.call_control_id ?? null,
  };
}

export function parseWiedergabeStatus(body) {
  return body?.data?.payload?.status ?? null;
}

export function parseSpeechResult(body) {
  return (body.Transcript || body.SpeechResult || "").trim();
}

const SAFE_CAUSE_TOKEN = /^[A-Za-z0-9_.:-]{1,48}$/;
function safeCauseToken(value) {
  const text = z.string().safeParse(value);
  if (!text.success) return undefined;
  const token = text.data.trim();
  return SAFE_CAUSE_TOKEN.test(token) ? token : undefined;
}

export function parseLifecycleEvent(body) {
  const status = body.CallStatus;
  const durationS = parseInt(body.CallDuration, 10);
  const diagnostics = {};
  if (Number.isFinite(durationS)) diagnostics.callDurationS = durationS;
  const hangupCause = safeCauseToken(body.HangupCause);
  const hangupSource = safeCauseToken(body.HangupSource);
  const sipHangupCause = safeCauseToken(body.SipHangupCause);
  if (hangupCause) diagnostics.hangupCause = hangupCause;
  if (hangupSource) diagnostics.hangupSource = hangupSource;
  if (sipHangupCause) diagnostics.sipHangupCause = sipHangupCause;
  return { status, diagnostics };
}

export function parseSpeakOutcome(body) {
  return parseSpeakEvent(body);
}

export { parseAnsweredBy };

export const telnyxWebhookEvents = {
  parseSpeechResult,
  parseLifecycleEvent,
  parseSpeakOutcome,
  parseAnsweredBy,
  parseCallControlEvent,
  parseWiedergabeStatus,
};

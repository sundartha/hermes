import { parseSpeakEvent } from "./speak-events.js";
import { parseAnsweredBy } from "../../answered-by.js";

export function parseSpeechResult(body) {
  return (body.Transcript || body.SpeechResult || "").trim();
}

const SAFE_CAUSE_TOKEN = /^[A-Za-z0-9_.:-]{1,48}$/;
function safeCauseToken(value) {
  if (typeof value !== "string") return undefined;
  const token = value.trim();
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
};

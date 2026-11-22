import { z } from "zod";
import { parseSpeakEvent } from "./speak-events.ts";
import { parseAnsweredBy } from "../../answered-by.ts";
import { CALL_CONTROL_EREIGNIS } from "../../call-control-ereignis.ts";

const EREIGNIS_VON_TYP = Object.freeze({
  "call.ringing": CALL_CONTROL_EREIGNIS.KLINGELT,
  "call.answered": CALL_CONTROL_EREIGNIS.ABGEHOBEN,
  "call.hangup": CALL_CONTROL_EREIGNIS.AUFGELEGT,
  "call.playback.ended": CALL_CONTROL_EREIGNIS.WIEDERGABE_ENDE,
});

const AUFLEGE_URSACHE_FELDER = Object.freeze({
  hangup_cause: "hangupCause",
  sip_hangup_cause: "sipHangupCause",
  hangup_source: "hangupSource",
});

function parseAufgelegtUrsache(payload) {
  const ursache = {};
  for (const [feld, name] of Object.entries(AUFLEGE_URSACHE_FELDER)) {
    const token = safeCauseToken(payload?.[feld]);
    if (token) ursache[name] = token;
  }
  return ursache;
}

export function parseCallControlEvent(body) {
  const data = body?.data;
  return {
    ereignis: Object.hasOwn(EREIGNIS_VON_TYP, data?.event_type) ? EREIGNIS_VON_TYP[data.event_type] : null,
    callControlId: data?.payload?.call_control_id ?? null,
    ...parseAufgelegtUrsache(data?.payload),
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

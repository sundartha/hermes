import { config } from "../config.js";
import * as store from "../store.js";
import { localeFor } from "../i18n/locales.js";
import { MS_PER_MINUTE } from "../utils/timer.js";
import { CONSULT_POLL_ABORT_MS } from "./delivery.js";
import { consultAllowedFor } from "./gate.js";
import { CONSULT_WAIT } from "../store/defaults.js";
import {
  callStartAnchorMs,
  consultAnswerAwaitingDelivery as consultAnswerAwaitingDeliveryOp,
  consultQuotaUsed,
} from "../store/state-ops.js";
import { sanitizeConsultQuestion } from "./question.js";

export const GET_CONSULT_TOOL_NAME = "get_consult";

export const CONSULT_WAIT_MS = config.tenancy.consultWaitMs;

export const CONSULT_OPEN_MS = config.tenancy.consultOpenMs;

export const CONSULT_POLL_FRESH_MS = CONSULT_POLL_ABORT_MS;

export const MAX_IN_CALL_CONSULTS_PER_CALL = 1;

function callAnswered(call) {
  return !Number.isNaN(Date.parse(call.answeredAt ?? ""));
}

export function consultClientIsPolling(call, nowMs = Date.now()) {
  return nowMs - (call.consultPolledAtMs || 0) <= CONSULT_POLL_FRESH_MS;
}

export function consultAnswerAwaitingDelivery(call) {
  return consultAnswerAwaitingDeliveryOp(call);
}

export function consultAvailableFor(call, nowMs = Date.now()) {
  return (
    config.tenancy.inCallConsultEnabled === true &&
    consultAllowedFor(store.resolveProfile(call.tenantId)) &&
    call.direction === "outbound" &&
    call.status === "active" &&
    callAnswered(call) &&
    consultClientIsPolling(call, nowMs) &&
    consultQuotaUsed(call) < MAX_IN_CALL_CONSULTS_PER_CALL
  );
}

export function consultFitsBillingMinute(call, nowMs = Date.now()) {
  const anchorMs = callStartAnchorMs(call);
  if (!Number.isFinite(anchorMs) || nowMs < anchorMs) return false;
  return ((nowMs - anchorMs) % MS_PER_MINUTE) + CONSULT_WAIT_MS <= MS_PER_MINUTE;
}

function logConsultAsked(callId) {
  console.log(`[consult] gestellt call=${callId} warte_ms=${CONSULT_WAIT_MS} offen_ms=${CONSULT_OPEN_MS}`);
}

export function decideConsultRequest(call, toolUses) {
  const requested = toolUses.find((tu) => tu.name === GET_CONSULT_TOOL_NAME);
  if (!requested) return null;
  const loc = localeFor(call.language);
  const declined = { accepted: false, toolResult: loc.prompt.turnControl.consultDeclined };
  if (toolUses.length > 1) return declined;
  if (!consultAvailableFor(call)) return declined;
  if (!consultFitsBillingMinute(call)) return declined;
  const question = sanitizeConsultQuestion(requested.input?.question, call.transcript);
  if (!question) return declined;
  store.emitConsult(call.id, [question]);
  logConsultAsked(call.id);
  return { accepted: true, speech: loc.consultFillerSpeech };
}

export function advanceConsultWait(call) {
  if (config.tenancy.inCallConsultEnabled !== true) return CONSULT_WAIT.NONE;
  return store.advanceInCallConsult(call.id, {
    nowMs: Date.now(),
    waitMs: CONSULT_WAIT_MS,
    openMs: CONSULT_OPEN_MS,
  });
}

export function acceptConsultAnswer(call, { eventId, facts }) {
  return store.answerConsult(call.id, {
    eventId,
    facts,
    nowMs: Date.now(),
    openMs: CONSULT_OPEN_MS,
  });
}

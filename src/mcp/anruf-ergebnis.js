import { resultCardView } from "../call-result.ts";
import { localeFor } from "../i18n/locales.js";
import { maskRestrictedText } from "../restricted-data.js";
import { failureReasonBase } from "../telephony/failure-reason.js";

export function mapStatus(call) {
  if (call.status === "active") return call.answeredAt ? "in_progress" : "dialing";
  return call.status;
}

export function callOutcomeView(call) {
  return { status: mapStatus(call), failure_reason: failureReasonBase(call.failureReason) };
}

const AWAIT_SUMMARY_PLACEHOLDER = localeFor("de").mcp.awaitSummary;

export function pickTranscript(callId, call, texts = null) {
  const failureSummary =
    texts && mapStatus(call) === "failed" ? texts.callFailedSummary(call.failureReason) : null;
  return {
    call_id: callId,
    result_summary: maskRestrictedText(call.summary || failureSummary || texts?.awaitSummary || AWAIT_SUMMARY_PLACEHOLDER),
    objective_achieved: call.objectiveAchieved ?? "unclear",
    ...maskedResultCard(call.result),
  };
}

export function maskResultCardFields(card) {
  return {
    outcome: maskRestrictedText(card.outcome),
    commitments: card.commitments.map(maskRestrictedText),
    counterparty_commitments: card.counterparty_commitments.map(maskRestrictedText),
    open_points: card.open_points.map(maskRestrictedText),
    next_step: maskRestrictedText(card.next_step),
  };
}

export function maskedResultCard(result) {
  return maskResultCardFields(resultCardView(result));
}

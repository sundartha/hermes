import { STIMMEN_ANZAHL_META_KEY } from "../ui/widget-i18n.js";
import { resultCardView } from "../call-result.ts";
import { localeFor } from "../i18n/locales.ts";
import { maskRestrictedText } from "../restricted-data.ts";
import { failureReasonBase } from "../telephony/failure-reason.ts";

export function mapStatus(call) {
  if (call.status === "active") return call.answeredAt ? "in_progress" : call.queued ? "queued" : "dialing";
  return call.status;
}

export function callOutcomeView(call) {
  return { status: mapStatus(call), failure_reason: failureReasonBase(call.failureReason) };
}

export function stimmenMeta(call) {
  return Number.isInteger(call.stimmenAnzahl) ? { [STIMMEN_ANZAHL_META_KEY]: call.stimmenAnzahl } : {};
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

export function maskedNextSteps(result) {
  return (result?.nextSteps ?? []).map((step) => ({
    type: step.type,
    text: maskRestrictedText(step.text),
    at: step.at,
  }));
}

export function maskedTranscript(lines) {
  return lines.map((line) => ({
    role: line.role === "agent" ? "agent" : "counterparty",
    text: maskRestrictedText(line.text),
  }));
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

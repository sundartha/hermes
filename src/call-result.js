export const RESULT_LIST_MAX_ITEMS = 3;
export const RESULT_TEXT_MAX_CHARS = 200;
export const RESULT_EVIDENCE_MAX_ITEMS = 2;
export const RESULT_EVIDENCE_MAX_CHARS = 160;

export function evidenceRetentionEnabled(privacy) {
  return privacy.evidenceRetentionDays > 0;
}

function clampedText(value, maxChars) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxChars);
}

function clampedList(value, maxItems, maxChars) {
  if (!Array.isArray(value)) return [];
  const cleaned = [];
  for (const entry of value) {
    const text = clampedText(entry, maxChars);
    if (text) cleaned.push(text);
    if (cleaned.length >= maxItems) break;
  }
  return cleaned;
}

export function normalizeCallResult(parsed, { evidenceAllowed }) {
  const card = {
    outcome: clampedText(parsed?.outcome, RESULT_TEXT_MAX_CHARS),
    commitments: clampedList(parsed?.commitments, RESULT_LIST_MAX_ITEMS, RESULT_TEXT_MAX_CHARS),
    counterpartyCommitments: clampedList(
      parsed?.counterparty_commitments,
      RESULT_LIST_MAX_ITEMS,
      RESULT_TEXT_MAX_CHARS,
    ),
    openPoints: clampedList(parsed?.open_points, RESULT_LIST_MAX_ITEMS, RESULT_TEXT_MAX_CHARS),
    nextStep: clampedText(parsed?.next_step, RESULT_TEXT_MAX_CHARS),
    facts: clampedList(parsed?.facts, RESULT_LIST_MAX_ITEMS, RESULT_TEXT_MAX_CHARS),
  };
  if (evidenceAllowed) {
    card.evidence = clampedList(parsed?.evidence, RESULT_EVIDENCE_MAX_ITEMS, RESULT_EVIDENCE_MAX_CHARS);
  }

  const hasContent =
    card.outcome !== null ||
    card.commitments.length > 0 ||
    card.counterpartyCommitments.length > 0 ||
    card.openPoints.length > 0 ||
    card.nextStep !== null ||
    card.facts.length > 0 ||
    (card.evidence && card.evidence.length > 0);
  return hasContent ? card : null;
}

export function stripResultEvidence(call) {
  if (!call.result || !("evidence" in call.result)) return false;
  delete call.result.evidence;
  return true;
}

export function resultCardView(result) {
  const card = result ?? {};
  return {
    outcome: card.outcome ?? null,
    commitments: card.commitments ?? [],
    counterparty_commitments: card.counterpartyCommitments ?? [],
    open_points: card.openPoints ?? [],
    next_step: card.nextStep ?? null,
  };
}

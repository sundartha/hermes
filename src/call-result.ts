export const RESULT_LIST_MAX_ITEMS = 3;
export const RESULT_TEXT_MAX_CHARS = 200;
export const RESULT_EVIDENCE_MAX_ITEMS = 2;
export const RESULT_EVIDENCE_MAX_CHARS = 160;

export interface ErgebnisKarte {
  outcome: string | null;
  commitments: string[];
  counterpartyCommitments: string[];
  openPoints: string[];
  nextStep: string | null;
  facts: string[];
  evidence?: string[];
}

interface GelesenesErgebnis {
  outcome?: unknown;
  commitments?: unknown;
  counterparty_commitments?: unknown;
  open_points?: unknown;
  next_step?: unknown;
  facts?: unknown;
  evidence?: unknown;
}

interface AnsichtKarte {
  outcome: string | null;
  commitments: string[];
  counterparty_commitments: string[];
  open_points: string[];
  next_step: string | null;
}

export function evidenceRetentionEnabled(privacy: { evidenceRetentionDays: number }): boolean {
  return privacy.evidenceRetentionDays > 0;
}

function clampedText(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxChars);
}

function clampedList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned: string[] = [];
  for (const entry of value) {
    const text = clampedText(entry, maxChars);
    if (text) cleaned.push(text);
    if (cleaned.length >= maxItems) break;
  }
  return cleaned;
}

function kartenHatInhalt(card: ErgebnisKarte) {
  return (
    card.outcome !== null ||
    card.commitments.length > 0 ||
    card.counterpartyCommitments.length > 0 ||
    card.openPoints.length > 0 ||
    card.nextStep !== null ||
    card.facts.length > 0 ||
    card.evidence && card.evidence.length > 0
  );
}

export function normalizeCallResult(
  parsed: GelesenesErgebnis | null | undefined,
  { evidenceAllowed }: { evidenceAllowed: boolean },
): ErgebnisKarte | null {
  const card: ErgebnisKarte = {
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

  return kartenHatInhalt(card) ? card : null;
}

export function stripResultEvidence(call: { result?: Record<string, unknown> | null }): Record<string, unknown> | null {
  if (!call.result || !("evidence" in call.result)) return null;
  return Object.fromEntries(Object.entries(call.result).filter(([schluessel]) => schluessel !== "evidence"));
}

export function resultCardView(result: Partial<ErgebnisKarte> | null | undefined): AnsichtKarte {
  const card: Partial<ErgebnisKarte> = result ?? {};
  return {
    outcome: card.outcome ?? null,
    commitments: card.commitments ?? [],
    counterparty_commitments: card.counterpartyCommitments ?? [],
    open_points: card.openPoints ?? [],
    next_step: card.nextStep ?? null,
  };
}

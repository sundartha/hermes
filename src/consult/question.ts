import {
  clampAtWordBoundary,
  containsVerbatimQuote,
  stripQuotedSpans,
  VERBATIM_QUOTE_MIN_WORDS,
} from "../utils/text.ts";
import type { TranscriptLine } from "../utils/text.ts";

export { VERBATIM_QUOTE_MIN_WORDS };

export const CONSULT_QUESTION_MAX_CHARS = 200;

export function sanitizeConsultQuestion(
  question: unknown,
  transcript: TranscriptLine[] | null | undefined,
): string | null {
  if (typeof question !== "string") return null;
  const text = stripQuotedSpans(question).replace(/\s+/g, " ").trim();
  if (containsVerbatimQuote(text, transcript)) return null;
  const clamped = clampAtWordBoundary(text, CONSULT_QUESTION_MAX_CHARS).trim();
  return clamped || null;
}

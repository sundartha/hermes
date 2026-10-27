import { clampWithoutSplittingRestrictedData } from "../restricted-data.js";
import {
  clampAtWordBoundary,
  containsVerbatimQuote,
  stripQuotedSpans,
  VERBATIM_QUOTE_MIN_WORDS,
} from "../utils/text.js";

export { VERBATIM_QUOTE_MIN_WORDS };

export const CONSULT_QUESTION_MAX_CHARS = 200;

function clampQuestion(text) {
  const wordBoundaryCut = clampAtWordBoundary(text, CONSULT_QUESTION_MAX_CHARS).length;
  return clampWithoutSplittingRestrictedData(text, wordBoundaryCut);
}

export function sanitizeConsultQuestion(question, transcript) {
  if (typeof question !== "string") return null;
  const text = stripQuotedSpans(question).replace(/\s+/g, " ").trim();
  if (containsVerbatimQuote(text, transcript)) return null;
  const clamped = clampQuestion(text).trim();
  return clamped || null;
}

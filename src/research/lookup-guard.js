import { KEY_FACTS_LIMITS, normNum } from "../store/defaults.js";
import { clampAtWordBoundary, containsVerbatimQuote, stripQuotedSpans } from "../utils/text.js";

export const LOOKUP_QUERY_MAX_CHARS = 120;
export const LOOKUP_MAX_FACTS = 3;

const LOOKUP_DIGIT_RUN_MAX = 4;

const NUMBER_SEPARATORS = /[\s\-/().]/g;
const NON_DIGITS = /\D+/g;
const DIGIT_RUN = new RegExp(`\\d{${LOOKUP_DIGIT_RUN_MAX + 1},}`);
const EMAIL_LIKE = /[^\s@]+@[^\s@]+/;
const NON_PRINTABLE = /\p{C}/gu;

function withoutNumberSeparators(text) {
  return text.replace(NUMBER_SEPARATORS, "");
}

function digitsOf(text) {
  return text.replace(NON_DIGITS, "");
}

function mentionsTarget(text, to) {
  const target = digitsOf(normNum(typeof to === "string" ? to : ""));
  return Boolean(target) && digitsOf(text).includes(target);
}

export function sanitizeLookupQuery(query, call) {
  if (typeof query !== "string") return null;
  const text = stripQuotedSpans(query).replace(/\s+/g, " ").trim();
  if (DIGIT_RUN.test(withoutNumberSeparators(text))) return null;
  if (EMAIL_LIKE.test(text)) return null;
  if (mentionsTarget(text, call?.to)) return null;
  if (containsVerbatimQuote(text, call?.transcript)) return null;
  return clampAtWordBoundary(text, LOOKUP_QUERY_MAX_CHARS).trim() || null;
}

export function lookupFactsFrom(rawFacts) {
  if (!Array.isArray(rawFacts)) return [];
  return rawFacts
    .filter((fact) => typeof fact === "string")
    .map((fact) => fact.replace(NON_PRINTABLE, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, LOOKUP_MAX_FACTS)
    .map((fact) => clampAtWordBoundary(fact, KEY_FACTS_LIMITS.maxLen));
}

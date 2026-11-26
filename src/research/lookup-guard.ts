import { KEY_FACTS_LIMITS } from "../begriffe/anrufe.ts";
import { normNum } from "../begriffe/rufnummern.js";
import { clampAtWordBoundary, containsVerbatimQuote, stripQuotedSpans } from "../utils/text.ts";
import type { TranscriptLine } from "../utils/text.ts";

export const LOOKUP_QUERY_MAX_CHARS = 120;
export const LOOKUP_MAX_FACTS = 3;

const LOOKUP_DIGIT_RUN_MAX = 4;

const NUMBER_SEPARATORS = /[\s\-/().]/g;
const NON_DIGITS = /\D+/g;
const DIGIT_RUN = new RegExp(`\\d{${String(LOOKUP_DIGIT_RUN_MAX + 1)},}`);
const EMAIL_LIKE = /[^\s@]+@[^\s@]+/;
const NON_PRINTABLE = /\p{C}/gu;

function withoutNumberSeparators(text: string): string {
  return text.replace(NUMBER_SEPARATORS, "");
}

function digitsOf(text: string): string {
  return text.replace(NON_DIGITS, "");
}

function einzeilig(fact: string): string {
  return fact.replace(NON_PRINTABLE, " ").replace(/\s+/g, " ").trim();
}

function mentionsTarget(text: string, to: unknown): boolean {
  const target = digitsOf(normNum(typeof to === "string" ? to : ""));
  return Boolean(target) && digitsOf(text).includes(target);
}

export function sanitizeLookupQuery(
  query: unknown,
  call: { to?: unknown; transcript?: TranscriptLine[] | null } | null | undefined,
): string | null {
  if (typeof query !== "string") return null;
  const text = stripQuotedSpans(query).replace(/\s+/g, " ").trim();
  if (DIGIT_RUN.test(withoutNumberSeparators(text))) return null;
  if (EMAIL_LIKE.test(text)) return null;
  if (mentionsTarget(text, call?.to)) return null;
  if (containsVerbatimQuote(text, call?.transcript)) return null;
  return clampAtWordBoundary(text, LOOKUP_QUERY_MAX_CHARS).trim() || null;
}

export function lookupFactsFrom(rawFacts: unknown): string[] {
  if (!Array.isArray(rawFacts)) return [];
  const kandidaten = rawFacts;
  const texte = kandidaten.filter((fact) => typeof fact === "string");
  const bereinigt = texte.map(einzeilig).filter(Boolean);
  return bereinigt.slice(0, LOOKUP_MAX_FACTS).map((fact) => clampAtWordBoundary(fact, KEY_FACTS_LIMITS.maxLen));
}

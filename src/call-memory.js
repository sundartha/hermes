import { clampAtWordBoundary } from "./utils/text.js";

export const MEMORY_MAX_CALLS = 3;

export const MEMORY_MAX_ENTRY_CHARS = 200;
export const MEMORY_MAX_CHARS = MEMORY_MAX_CALLS * MEMORY_MAX_ENTRY_CHARS;

const MEMORY_MAX_OUTCOME_CHARS = MEMORY_MAX_ENTRY_CHARS / 2;

const MEMORY_PART_SEPARATOR = "; ";

function singleLine(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

const MEMORY_CUT_MARK = "…";

function clampMarked(text, maxChars) {
  if (text.length <= maxChars) return text;
  return clampAtWordBoundary(text, maxChars - 1) + MEMORY_CUT_MARK;
}

export function memoryLine(entry) {
  const outcome = clampMarked(singleLine(entry?.outcome), MEMORY_MAX_OUTCOME_CHARS);
  const facts = Array.isArray(entry?.facts) ? entry.facts.map(singleLine).filter(Boolean) : [];
  const parts = [];
  if (outcome) parts.push(outcome);
  if (facts.length) parts.push(facts.join(MEMORY_PART_SEPARATOR));
  if (!parts.length) return null;
  return clampMarked(parts.join(MEMORY_PART_SEPARATOR), MEMORY_MAX_ENTRY_CHARS);
}

export function budgetedMemoryLines(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(memoryLine)
    .filter(Boolean)
    .slice(0, MEMORY_MAX_CALLS);
}

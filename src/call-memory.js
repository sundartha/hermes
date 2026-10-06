export const MEMORY_MAX_CALLS = 3;

export const MEMORY_MAX_ENTRY_CHARS = 200;
export const MEMORY_MAX_CHARS = MEMORY_MAX_CALLS * MEMORY_MAX_ENTRY_CHARS;

const MEMORY_MAX_OUTCOME_CHARS = MEMORY_MAX_ENTRY_CHARS / 2;

const MEMORY_PART_SEPARATOR = "; ";

function singleLine(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

export function memoryLine(entry) {
  const outcome = singleLine(entry?.outcome).slice(0, MEMORY_MAX_OUTCOME_CHARS);
  const facts = Array.isArray(entry?.facts) ? entry.facts.map(singleLine).filter(Boolean) : [];
  const parts = [];
  if (outcome) parts.push(outcome);
  if (facts.length) parts.push(facts.join(MEMORY_PART_SEPARATOR));
  if (!parts.length) return null;
  return parts.join(MEMORY_PART_SEPARATOR).slice(0, MEMORY_MAX_ENTRY_CHARS);
}

export function budgetedMemoryLines(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(memoryLine)
    .filter(Boolean)
    .slice(0, MEMORY_MAX_CALLS);
}

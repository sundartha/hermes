export function clampAtWordBoundary(text, maxChars) {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

export const VERBATIM_QUOTE_MIN_WORDS = 6;

const QUOTE_CHAR_CLASS = "\"'„“”«»‚‘’";
const QUOTED_SPAN = new RegExp(`[${QUOTE_CHAR_CLASS}][^${QUOTE_CHAR_CLASS}]*[${QUOTE_CHAR_CLASS}]`, "g");
const QUOTE_CHAR = new RegExp(`[${QUOTE_CHAR_CLASS}]`, "g");

export function stripQuotedSpans(text) {
  return text.replace(QUOTED_SPAN, " ").replace(QUOTE_CHAR, " ");
}

export function comparableWords(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

export function containsVerbatimQuote(text, transcript) {
  const words = comparableWords(text);
  if (words.length < VERBATIM_QUOTE_MIN_WORDS) return false;
  const callerLines = (Array.isArray(transcript) ? transcript : [])
    .filter((entry) => entry?.role === "caller" && typeof entry.text === "string")
    .map((entry) => comparableWords(entry.text).join(" "));
  if (!callerLines.length) return false;
  for (let i = 0; i + VERBATIM_QUOTE_MIN_WORDS <= words.length; i++) {
    const window = words.slice(i, i + VERBATIM_QUOTE_MIN_WORDS).join(" ");
    if (callerLines.some((line) => line.includes(window))) return true;
  }
  return false;
}

export const PROMPT = "$ ";
const FLAG_PREFIX = "--";
const URL_PATTERN = /^https?:/;

export function codeTokens(code, options = {}) {
  const words = code.split(" ");
  let flagValue = false;
  const tokens = words.map((word, index) => {
    const text = index < words.length - 1 ? `${word} ` : word;
    let kind = "n";
    if (words.length === 1) kind = "n";
    else if (word.startsWith(FLAG_PREFIX)) {
      kind = "f";
      flagValue = true;
    } else if (flagValue) {
      kind = "f";
      flagValue = false;
    } else if (URL_PATTERN.test(word)) kind = "u";
    return { kind, en: text, de: text };
  });
  const prompt = options.prompt ? [{ kind: "p", en: PROMPT, de: PROMPT }] : [];
  return [[...prompt, ...tokens]];
}

export function typeableLength(texts) {
  return texts.reduce((sum, text) => sum + text.length, 0);
}

export function typedSplit(texts, count) {
  let offset = 0;
  let caret = -1;
  const total = typeableLength(texts);
  const parts = texts.map((text, index) => {
    const shown = Math.max(0, Math.min(text.length, count - offset));
    if (count < total && count >= offset && count < offset + text.length) caret = index;
    offset += text.length;
    return { on: text.slice(0, shown), off: text.slice(shown) };
  });
  return { parts, caret };
}

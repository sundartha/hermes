/* =============================================================================
 * mobile-code.js - Code-Feld der Handy-Startseite ("Fuer Entwickler")
 *
 * Reine Funktionen ohne DOM: components/MobileHome.astro zerlegt damit den
 * Befehl in farbige Teilstuecke, scripts/hermes-mobile.js rechnet beim Tippen
 * aus, wie viel davon schon steht (per node:test geprueft).
 *
 * Arten (Design-Schema 6.4): p = Prompt "$ " und f = Flag samt Wert in
 * Himmelblau, u = URL in Hellblau, n = Rest, b = fetter Link ("Your AI").
 * Der Prompt wird nicht getippt, er steht von Anfang an.
 * ========================================================================== */

export const PROMPT = "$ ";
const FLAG_PREFIX = "--";
const URL_PATTERN = /^https?:/;

/* Befehl -> eine Zeile aus Teilstuecken; jedes Wort traegt sein Leerzeichen.
 * Ein Flag faerbt auch das Wort danach (seinen Wert). Ohne Leerzeichen (reine
 * URL) bleibt es ein einziges Stueck der Art n - wie im Prototyp. */
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

/* Wie viele Zeichen zaehlen beim Tippen (ohne Prompt). */
export function typeableLength(texts) {
  return texts.reduce((sum, text) => sum + text.length, 0);
}

/* Teilt die Stuecke nach count getippten Zeichen: je Stueck der stehende Teil
 * (on) und der noch transparente Rest (off). caret ist der Index des Stuecks,
 * hinter dessen stehendem Teil der Cursor sitzt, oder -1, wenn alles steht. */
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

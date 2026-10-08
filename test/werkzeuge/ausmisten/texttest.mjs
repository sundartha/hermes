export const TEXTTEST = "test/post/text.test.js";
export const TEXTFALL = "liest den Quelltext";
export const VERHALTEN = "kürzt den Eingang im Texttest";
export const ANDERER = "kürzt auch Tabulatoren";

export function fall(name, zeilen) {
  return [
    `test(${JSON.stringify(name)}, () => {`,
    ...zeilen.map((zeile) => `  ${zeile}`),
    "});",
    "",
  ];
}

export const LESEN = [
  'const quelle = readFileSync(new URL("../../src/post/eingang.js", import.meta.url), "utf8");',
  'assert.ok(quelle.includes("return text.trim();"));',
];
export const KUERZEN = ['assert.equal(eingang(" a "), "a");'];
export const TABULATOR = ['assert.equal(eingang("\\tb\\t"), "b");'];

export function texttest(...faelle) {
  const liest = faelle.flat().some((zeile) => zeile.includes("readFileSync"));
  return [
    'import assert from "node:assert/strict";',
    ...(liest ? ['import { readFileSync } from "node:fs";'] : []),
    'import { test } from "node:test";',
    'import { eingang } from "../../src/post/eingang.js";',
    "",
    ...faelle.flat(),
  ].join("\n");
}

export const MIT_TEXT = texttest(fall(TEXTFALL, LESEN), fall(VERHALTEN, KUERZEN));

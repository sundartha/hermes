import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { deklarationen, eingebetteterText, enthaeltHelfer, mutantenIn } from "../../tools/mutationspruefung/einbettung-text.mjs";

const DATEI = "src/widget.js";
const ORIGINAL = [
  "export function f(x) {",
  "  return x + 1;",
  "}",
  "function g(x) {",
  "  return x * 2;",
  "}",
  "export async function wartend() {}",
  "export function* zaehler() {}",
  "function doppelt() {}",
  "function aussen() {",
  "  function doppelt() {}",
  "}",
  "export default function () {}",
  "",
].join("\n");
const F_UMGESETZT = [
  "function f(x) {",
  '  if (stryMutAct_9fa48("7")) {',
  "    {}",
  "  } else {",
  '    stryCov_9fa48("7");',
  '    return stryMutAct_9fa48("8") ? x - 1 : (stryCov_9fa48("8"), x + 1);',
  "  }",
  "}",
].join("\n");
const G_UMGESETZT = [
  "function g(x) {",
  '  return stryMutAct_9fa48("10") ? x / 2 : (stryCov_9fa48("10"), x * 2);',
  "}",
].join("\n");
const STRIKT_UMGESETZT = [
  "function f(x) {",
  '  "use strict";',
  '  return stryMutAct_9fa48("8") ? this === undefined : (stryCov_9fa48("8"), this !== undefined);',
  "}",
].join("\n");
const ORIGINAL_F = "function f(x) {\n  return x + 1;\n}";
const ORIGINAL_G = "function g(x) {\n  return x * 2;\n}";
const TABELLE = deklarationen(ORIGINAL);

function eingebettet(text, name, aktiv) {
  return eingebetteterText({ text, name, aktiv, tabelle: () => TABELLE, datei: DATEI });
}

function lauf(text, aufruf) {
  return runInNewContext(`${text};\n${aufruf}`);
}

test("Ohne aktiven Mutanten oder mit einem Mutanten aus einer anderen Funktion liefert die Einbettung den Originaltext der Funktion, der Mutant der Funktion selbst die Schalterfassung, die ihn im Skript wirksam macht", () => {
  const faelle = [
    ["inaktiv", F_UMGESETZT, "f", undefined, ORIGINAL_F],
    ["fremder Mutant", F_UMGESETZT, "f", "10", ORIGINAL_F],
    ["fremder Mutant bei g", G_UMGESETZT, "g", "8", ORIGINAL_G],
    ["unbekannter Mutant", F_UMGESETZT, "f", "99", ORIGINAL_F],
  ];
  for (const [fall, text, name, aktiv, erwartet] of faelle) assert.equal(eingebettet(text, name, aktiv), erwartet, fall);
  assert.equal(lauf(eingebettet(F_UMGESETZT, "f", "8"), "f(5)"), 4);
  assert.equal(lauf(eingebettet(F_UMGESETZT, "f", "7"), "f(5)"), undefined);
  assert.equal(lauf(eingebettet(G_UMGESETZT, "g", "10"), "g(6)"), 3);
});

test("Eine Funktion mit Direktive behält sie als erste Anweisung, die Helfer kommen dahinter", () => {
  const text = eingebettet(STRIKT_UMGESETZT, "f", "8");
  assert.match(text, /^function f\(x\) \{\n {2}"use strict"; var stryMutAct_9fa48 = /);
  assert.equal(lauf(text, "f()"), true);
});

test("Der Originaltext einer Deklaration ist, was toString() ohne Instrumentierung lieferte, auch mit export, async und Generator", () => {
  assert.deepEqual(
    [...TABELLE.entries()],
    [
      ["f", [ORIGINAL_F]],
      ["g", [ORIGINAL_G]],
      ["wartend", ["async function wartend() {}"]],
      ["zaehler", ["function* zaehler() {}"]],
      ["doppelt", ["function doppelt() {}", "function doppelt() {}"]],
      ["aussen", ["function aussen() {\n  function doppelt() {}\n}"]],
    ],
  );
});

test("Eine Funktion, deren Name zweimal deklariert ist, eine ohne Deklaration, eine ohne Namen und eine in Pfeilschreibweise brechen mit klarer Meldung ab, mit und ohne aktiven Mutanten", () => {
  const pfeil = '(x) => (stryMutAct_9fa48("3") ? x - 1 : (stryCov_9fa48("3"), x + 1))';
  const faelle = [
    ["doppelt", F_UMGESETZT, "doppelt", undefined, /Einbettung: doppelt ist in src\/widget\.js mehrdeutig, 2 Funktionsdeklarationen/],
    ["fehlt", F_UMGESETZT, "fehlt", undefined, /Einbettung: fehlt ist in src\/widget\.js keine Funktionsdeklaration/],
    ["ohne Namen", F_UMGESETZT, "", undefined, /Einbettung: \(ohne Namen\) ist in src\/widget\.js keine Funktionsdeklaration/],
    ["Pfeil, inaktiv", pfeil, "h", undefined, /Einbettung: h ist in src\/widget\.js keine Funktionsdeklaration/],
    ["Pfeil, aktiv", pfeil, "h", "3", /Einbettung: eingebettet wird nur eine Funktion mit Rumpf in function-Schreibweise/],
    ["Pfeil in Klammern, aktiv", `(${F_UMGESETZT})`, "f", "8", /Einbettung: eingebettet wird nur eine Funktion mit Rumpf in function-Schreibweise/],
  ];
  for (const [fall, text, name, aktiv, meldung] of faelle) assert.throws(() => eingebettet(text, name, aktiv), meldung, fall);
});

test("Ein Stryker-Helfer, den die Einbettung nicht kennt, bricht ab, statt einen Text mit unaufgelösten Aufrufen zu liefern", () => {
  const text = F_UMGESETZT.replace('stryCov_9fa48("8")', "stryNS_9fa48()");
  assert.throws(() => eingebettet(text, "f", "8"), /Einbettung: unbekannter Stryker-Helfer im eingebetteten Text: stryNS_9fa48/);
});

test("Ein Text mit Stryker-Helfern wird als instrumentiert erkannt, ein gewöhnlicher nicht, und die Mutanten des Textes werden einzeln gezählt", () => {
  assert.equal(enthaeltHelfer(F_UMGESETZT), true);
  assert.equal(enthaeltHelfer('stryCov_9fa48("1")'), true);
  assert.equal(enthaeltHelfer(ORIGINAL_F), false);
  assert.deepEqual(mutantenIn(F_UMGESETZT), ["7", "8"]);
  assert.deepEqual(mutantenIn(`${F_UMGESETZT}\n${F_UMGESETZT}`), ["7", "8"]);
  assert.deepEqual(mutantenIn(ORIGINAL_F), []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGEL = "hermes/monatsrechnung-aus-month";
const MONATSMODUL = "src/utils/month.js";

const eslint = new ESLint({ cwd: WURZEL });

async function befunde(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === REGEL);
}

async function erwarteBefund(quelltext, datei = "src/probe-monat.js") {
  const gefunden = await befunde(datei, quelltext);
  assert.equal(gefunden.length, 1, `Monatsregel: ${quelltext} wurde nicht genau einmal gemeldet`);
  assert.match(gefunden[0].message, /src\/utils\/month\.js/);
}

async function erwarteKeinen(datei, quelltext) {
  const gefunden = await befunde(datei, quelltext);
  assert.deepEqual(gefunden, [], `Monatsregel: ${datei} wurde gemeldet`);
}

test("Monatsregel: getUTCMonth() - 1 in src/ ist ein Fehler, der auf month.js verweist", () =>
  erwarteBefund("export const a = (d) => d.getUTCMonth() - 1;\n"));
test("Monatsregel: getUTCMonth() + 1 in src/ ist ein Fehler, der auf month.js verweist", () =>
  erwarteBefund("export const a = (d) => d.getUTCMonth() + 1;\n"));
test("Monatsregel: 1 + getUTCMonth() in src/ ist ein Fehler, der auf month.js verweist", () =>
  erwarteBefund("export const a = (d) => 1 + d.getUTCMonth();\n"));
test("Monatsregel: setUTCMonth in src/ ist ein Fehler, der auf month.js verweist", () =>
  erwarteBefund("export const a = (d, x) => d.setUTCMonth(x);\n"));
test("Monatsregel: Date.UTC mit Monatsrechnung in src/ ist ein Fehler, der auf month.js verweist", () =>
  erwarteBefund("export const a = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);\n"));
test("Monatsregel: Date.UTC mit Monatsrechnung ohne getUTCMonth ist ein Fehler, der auf month.js verweist", () =>
  erwarteBefund("export const a = (y, m) => Date.UTC(y, m - 1, 1);\n"));
test("Monatsregel: Date.UTC mit Monat als Namen bleibt ohne Meldung", () =>
  erwarteKeinen("src/probe-monat.js", "export const a = (y, m) => Date.UTC(y, m, 1);\n"));

const ROH = "export const a = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) + d.getUTCMonth() - 1;\n";
test("Monatsregel: month.js selbst ist nicht Teil der Regel", () => erwarteKeinen(MONATSMODUL, ROH));
test("Monatsregel: test/ ist nicht Teil der Regel", () => erwarteKeinen("test/probe-monat.js", ROH));
test("Monatsregel: scripts/ ist nicht Teil der Regel", () => erwarteKeinen("scripts/probe-monat.mjs", ROH));

test("Monatsregel: ein reines getUTCMonth() ohne Rechnung bleibt ohne Meldung", () =>
  erwarteKeinen("src/probe-monat.js", "export const a = (d) => d.getUTCMonth();\n"));
test("Monatsregel: getUTCMonth() mit Vergleich bleibt ohne Meldung", () =>
  erwarteKeinen("src/probe-monat.js", "export const a = (d) => d.getUTCMonth() === 11;\n"));
test("Monatsregel: der Aufruf der Helfer aus month.js bleibt ohne Meldung", () =>
  erwarteKeinen(
    "src/probe-monat.js",
    'import { yearMonthKey, previousMonthStart } from "./utils/month.js";\nexport const a = (d) => yearMonthKey(previousMonthStart(d));\n',
  ));

function gitGrep(...argumente) {
  try {
    return execFileSync("git", ["grep", ...argumente], { cwd: WURZEL, encoding: "utf8" });
  } catch (fehler) {
    assert.equal(fehler.status, 1, "git grep ist fehlgeschlagen");
    return "";
  }
}

test("Monatsregel: keine Bestandsliste und keine Unterdrückung für die Regel", () => {
  const unterdrueckt = readFileSync(resolve(WURZEL, "eslint-suppressions.json"), "utf8");
  assert.equal(unterdrueckt.includes(REGEL), false);
  assert.equal(gitGrep("-l", "monatsrechnung-aus-month", "--", "tools/basis"), "");
});

test("Monatsregel: unter src/ steht außer month.js keine Monatsrechnung", () => {
  const treffer = gitGrep("-nE", String.raw`getUTCMonth\(\) *[-+]|setUTCMonth|Date\.UTC\(`, "--", "src/*.js", ":!src/utils/month.js");
  assert.equal(treffer, "");
});

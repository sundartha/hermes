import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGEL = "hermes/zeiteinheiten-aus-timer";
const ZEITMODUL = "src/utils/timer.js";
const IMPORT = 'import { MS_PER_MINUTE } from "./utils/timer.js";\n';

const eslint = new ESLint({ cwd: WURZEL });

async function befunde(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === REGEL);
}

async function erwarteBefund(quelltext, datei = "src/probe-zeit.js", anzahl = 1) {
  const gefunden = await befunde(datei, quelltext);
  assert.equal(gefunden.length, anzahl, `Zeiteinheiten-Regel: ${quelltext} wurde nicht ${anzahl}-mal gemeldet`);
  assert.match(gefunden[0].message, /src\/utils\/timer\.js/);
}

async function erwarteKeinen(datei, quelltext) {
  const gefunden = await befunde(datei, quelltext);
  assert.deepEqual(gefunden, [], `Zeiteinheiten-Regel: ${datei} wurde gemeldet`);
}

const VERSTOESSE = [
  ["eine neue MS_PER_DAY-Kopie mit Rohzahl", "const MS_PER_DAY = 86_400_000;\nexport const a = MS_PER_DAY;\n", 2],
  ["ein anderer Wert unter dem Namen MS_PER_HOUR", "export const MS_PER_HOUR = 1;\n"],
  ["eine MS_PER_SECOND-Kopie", "const MS_PER_SECOND = 1000;\nexport const a = MS_PER_SECOND;\n"],
  ["eine MS_PER_MINUTE-Kopie", "const MS_PER_MINUTE = 5;\nexport const a = MS_PER_MINUTE;\n"],
  ["x * 1000", "export const a = (x) => x * 1000;\n"],
  ["1000 * x", "export const a = (x) => 1000 * x;\n"],
  ["x / 1000", "export const a = (x) => x / 1000;\n"],
  ["60 * 1000", "export const a = 60 * 1000;\n"],
  ["60 * 60 * 1000", "export const a = 60 * 60 * 1000;\n"],
  ["24 * 60 * 60 * 1000", "export const a = 24 * 60 * 60 * 1000;\n"],
  ["60_000", "export const a = 60_000;\n"],
  ["60000", "export const a = 60000;\n"],
  ["3_600_000", "export const a = 3_600_000;\n"],
  ["86_400_000", "export const a = 86_400_000;\n"],
];

for (const [name, quelltext, anzahl] of VERSTOESSE)
  test(`Zeiteinheiten-Regel: ${name} in src/ ist ein Fehler, der auf timer.js verweist`, () =>
    erwarteBefund(quelltext, "src/probe-zeit.js", anzahl));

const ERLAUBT = [
  ["ein Name aus timer.js als Faktor", `${IMPORT}export const a = MS_PER_MINUTE * 5;\n`],
  ["ein Name aus timer.js als Teiler", `${IMPORT}export const a = (x) => x / MS_PER_MINUTE;\n`],
  ["der Re-Export aus timer.js", 'export { MS_PER_SECOND } from "./utils/timer.js";\n'],
  ["ein Zeichenlimit 1000", "export const a = 1000;\n"],
  ["eine Summe mit 1000", "export const a = (x) => x + 1000;\n"],
  ["Nanosekunden und Geld 1_000_000", "export const a = (x) => x * 1_000_000;\n"],
  ["ein anderer Faktor", "export const a = (x) => x * 100;\n"],
];

for (const [name, quelltext] of ERLAUBT)
  test(`Zeiteinheiten-Regel: ${name} bleibt ohne Meldung`, () => erwarteKeinen("src/probe-zeit.js", quelltext));

const ROH = "export const MS_PER_DAY = 86_400_000;\nexport const a = (x) => x * 1000;\n";
test("Zeiteinheiten-Regel: das Zeitmodul selbst ist nicht Teil der Regel", () => erwarteKeinen(ZEITMODUL, ROH));
test("Zeiteinheiten-Regel: das Browser-Skript wing-canvas-engine.js ist ausgenommen", () =>
  erwarteKeinen("src/ui/wing-canvas-engine.js", ROH));
test("Zeiteinheiten-Regel: test/ ist nicht Teil der Regel", () => erwarteKeinen("test/probe-zeit.js", ROH));
test("Zeiteinheiten-Regel: scripts/ ist nicht Teil der Regel", () => erwarteKeinen("scripts/probe-zeit.mjs", ROH));

test("Zeiteinheiten-Regel: eine andere Datei unter src/ui/ ist nicht ausgenommen", () =>
  erwarteBefund("export const a = (x) => x / 1000;\n", "src/ui/anderes.js"));

function gitGrep(...argumente) {
  try {
    return execFileSync("git", ["grep", ...argumente], { cwd: WURZEL, encoding: "utf8" });
  } catch (fehler) {
    assert.equal(fehler.status, 1, "git grep ist fehlgeschlagen");
    return "";
  }
}

test("Zeiteinheiten-Regel: keine Bestandsliste und keine Unterdrückung für die Regel", () => {
  const unterdrueckt = readFileSync(resolve(WURZEL, "eslint-suppressions.json"), "utf8");
  assert.equal(unterdrueckt.includes(REGEL), false);
  assert.equal(gitGrep("-l", "zeiteinheiten-aus-timer", "--", "tools/basis"), "");
});

test("Zeiteinheiten-Regel: unter src/ steht außer timer.js und wing-canvas-engine.js keine Rohzahl und keine Kopie", () => {
  const muster = String.raw`\bMS_PER_(SECOND|MINUTE|HOUR|DAY)\s*=|[*/]\s*1000\b(?![_.\d])|\b60_?000\b|\b3_?600_?000\b|\b86_?400_?000\b`;
  const treffer = gitGrep("-nP", muster, "--", "src/*.js", ":!src/utils/timer.js", ":!src/ui/wing-canvas-engine.js");
  assert.equal(treffer, "");
});

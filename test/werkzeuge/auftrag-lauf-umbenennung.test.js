import assert from "node:assert/strict";
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { MIT_PIN_PRUEFUNG } from "./auftrag-lauf-hilfen.js";
import { BASIS, EXIT_ROT, starte } from "./auftrag-lauf-probe.js";
import { BASE_FILES, MANIFEST_BOTH, RENAMED_FILES } from "./feste-pfade-probe.js";
import { REPO_ROOT, runIn } from "./probe-repo.js";

const TEXT_TS = "export function gross(text: string): string {\n  return text.toUpperCase();\n}\n";
const UMBENENNUNG = {
  id: "A1",
  art: "umbau",
  ziel: "Typisiere src/text.js",
  bereich: "src/text.js",
  erwarteteDateien: ["src/text.ts"],
  vorbild: "src/text.js",
  abnahme: "test/text.test.js",
};
const DREHBUCH = { "bau-umbenennen": [["src/text.js", "src/text.ts"]], bau: { "src/text.ts": TEXT_TS } };
const SCHUTZLISTEN = [
  ".claude/rollen/bau.json",
  ".claude/settings.json",
  ".dependency-cruiser.cjs",
  ".github/workflows/probe.yml",
  "tools/auftrag/agenten.mjs",
  "tools/auftrag/bereiche.mjs",
  "tools/auftrag/musterdateien.json",
  "tools/bereiche.json",
  "tools/eslint-rules/index.js",
  "tools/eslint-rules/tests.js",
  "tools/gate-tests.json",
  "tools/ziele/geschuetzt.json",
];
const MIT_SCHUTZLISTEN = {
  ...Object.fromEntries(SCHUTZLISTEN.map((pfad) => [pfad, BASE_FILES[pfad]])),
  ...MANIFEST_BOTH,
  "eslint.config.js": RENAMED_FILES["eslint.config.js"],
  ".gitignore": `${BASIS[".gitignore"]}node_modules\n`,
};

function mitModulen(repo) {
  symlinkSync(join(REPO_ROOT, "node_modules"), join(repo, "node_modules"));
}

function umbenannt(context, drehbuch, dateien = {}) {
  return starte(context, { auftrag: UMBENENNUNG, drehbuch, dateien: { ...MIT_SCHUTZLISTEN, ...dateien }, vorbereiten: mitModulen });
}

test("auftrag-lauf-umbenennung: ein Umbau, der eine Datei nur mit Typen nach .ts umbenennt, endet mit Commit samt nachgezogenem Test", (context) => {
  const { repo, lauf, beleg, basis, kopf } = umbenannt(context, DREHBUCH);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.notEqual(kopf, basis);
  assert.equal(runIn(repo, "git", ["diff", "--name-status", "--no-renames", basis, "HEAD"]).stdout, "D\tsrc/text.js\nA\tsrc/text.ts\nM\ttest/text.test.js\n");
  assert.match(runIn(repo, "git", ["show", "HEAD:test/text.test.js"]).stdout, /from "\.\.\/src\/text\.ts";/);
  const grenze = beleg.pruefungen.find(({ name }) => name === "grenzen bau");
  assert.ok(grenze.zeilen.includes("grün: 3 Dateien geändert, 1 neue Zeilen Produktcode, Rolle bau."), grenze.zeilen.join("\n"));
});

test("auftrag-lauf-umbenennung: ändert der Bau-Agent beim Umbenennen den Test über die Endung hinaus, endet der Lauf ohne Commit mit Test im Bau", (context) => {
  const erweitert = `${BASIS["test/text.test.js"].replace("../src/text.js", "../src/text.ts")}test("leer", () => assert.equal(gross(""), ""));\n`;
  const drehbuch = { ...DREHBUCH, bau: { ...DREHBUCH.bau, "test/text.test.js": erweitert } };
  const { lauf, beleg, basis, kopf } = umbenannt(context, drehbuch);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(kopf, basis);
  assert.ok(JSON.stringify(beleg).includes("Der Bau-Agent hat einen Test geändert: test/text.test.js"), JSON.stringify(beleg));
});

test("auftrag-lauf-umbenennung: meldet der Bau-Agent nach dem Umbenennen einen alten Test, zieht der Lauf die Importe vor grenzen bau nach", (context) => {
  const alterTest = BASIS["test/text.test.js"].replace('test("gross"', 'test("gross bleibt"');
  const zeile = "Alter Test hält altes Verhalten fest: test/gross.test.js:gross bleibt – Das Ziel verlangt nur Typen.";
  const drehbuch = { ...DREHBUCH, "bau-antwort": zeile, "notiz-antwort": "1. Klären" };
  const { lauf, beleg } = umbenannt(context, drehbuch, { "test/gross.test.js": alterTest });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual([beleg.alterTest?.datei, beleg.alterTest?.rot], ["test/gross.test.js", false], JSON.stringify(beleg.pruefungen));
  assert.match(beleg.alterTest.diff, /^\+import \{ gross \} from "\.\.\/src\/text\.ts";$/m);
});

const FUELLFUNKTIONEN = ["eins", "zwei", "drei", "vier", "fuenf", "sechs"];
const QUELLE_MIT_ERKANNTER_UMBENENNUNG = `export function gross(text) {\n  return text.toUpperCase();\n}\n${FUELLFUNKTIONEN.map((name) => `export function ${name}() {\n  return "${name}";\n}\n`).join("")}`;
const MIT_PIN = { "src/text.js": QUELLE_MIT_ERKANNTER_UMBENENNUNG, "scripts/check-staged-suppressions.js": MIT_PIN_PRUEFUNG["scripts/check-staged-suppressions.js"], ".gitignore": `${BASIS[".gitignore"]}node_modules\npin-aufrufe.txt\n` };

test("auftrag-lauf-umbenennung: die Pin-Prüfung bekommt eine per git mv umbenannte Datei und hält ihre neue Unterdrückung auf", (context) => {
  const drehbuch = { "bau-umbenennen": [["src/text.js", "src/text.ts"]], bau: { "src/text.ts": `declare const _: number;\n${QUELLE_MIT_ERKANNTER_UMBENENNUNG}` } };
  const { repo, lauf, basis, kopf } = umbenannt(context, drehbuch, MIT_PIN);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(kopf, basis);
  assert.ok(readFileSync(join(repo, "pin-aufrufe.txt"), "utf8").includes('"src/text.ts"'));
});

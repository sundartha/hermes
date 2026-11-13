import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { Linter } from "eslint";

import regel from "../../tools/eslint-rules/keine-selbstaufruf.js";

const WURZEL = resolve(import.meta.dirname, "../..");
const WAECHTER = join(WURZEL, "tools/schwerlauf/tiefe.mjs");
const EXIT_ZU_TIEF = 4;
const DATEI = "test/beispiel.test.js";
const KOPF = 'import { spawnSync } from "node:child_process";\n';

function befunde(quelltext) {
  const linter = new Linter();
  const konfiguration = [
    {
      plugins: { x: { rules: { selbst: regel } } },
      rules: { "x/selbst": "error" },
      languageOptions: { sourceType: "module", ecmaVersion: "latest" },
    },
  ];
  return linter.verify(quelltext, konfiguration, DATEI).filter((meldung) => meldung.ruleId === "x/selbst");
}

test("Prüfregel: der eigene Dateiname im Kindprozess ist ein Befund", () => {
  const quelltext = `${KOPF}import { fileURLToPath } from "node:url";\nspawnSync(process.execPath, ["--test", fileURLToPath(import.meta.url)]);\n`;
  assert.equal(befunde(quelltext).length, 1);
});

test("Prüfregel: node --test nur mit Muster und ohne Datei trifft auch diesen Test", () => {
  assert.equal(befunde(`${KOPF}spawnSync(process.execPath, ["--test", "--test-name-pattern=SF-K2:"]);\n`).length, 1);
});

test("Prüfregel: eine feste andere Datei ist kein Befund", () => {
  const quelltext = `${KOPF}const ZIEL = "test/gemeinsam/anderer.test.js";\nspawnSync(process.execPath, ["--test", ZIEL]);\n`;
  assert.equal(befunde(quelltext).length, 0);
});

test("Wächter: ab TEST_TIEFE=2 bricht eine Testdatei sofort mit Meldung ab", () => {
  const ordner = mkdtempSync(join(tmpdir(), "selbstaufruf-wacht-"));
  const datei = join(ordner, "kind.test.js");
  writeFileSync(datei, 'console.log("gelaufen");\n');
  const lauf = (tiefe) => spawnSync(process.execPath, ["--import", WAECHTER, datei], { env: { ...process.env, TEST_TIEFE: tiefe }, encoding: "utf8" });
  assert.equal(lauf("1").status, 0);
  const zuTief = lauf("2");
  assert.equal(zuTief.status, EXIT_ZU_TIEF);
  assert.match(zuTief.stderr, /Ein Test startet sich vermutlich selbst/);
  assert.doesNotMatch(zuTief.stdout, /gelaufen/);
});

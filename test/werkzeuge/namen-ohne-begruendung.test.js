import assert from "node:assert/strict";
import { test } from "node:test";
import { ESLint, Linter } from "eslint";

import hermes from "../../tools/eslint-rules/index.js";
import { REPO_ROOT } from "./probe-repo.js";

const RULE = "hermes/namen-ohne-begruendung";
const WARNUNG = 1;

function gemeldeteNamen(quelltext) {
  const linter = new Linter();
  const config = { plugins: { hermes }, rules: { [RULE]: "warn" } };
  return linter
    .verify(quelltext, config)
    .filter(({ ruleId }) => ruleId === RULE)
    .map(({ line, column, endColumn }) =>
      quelltext.split("\n")[line - 1].slice(column - 1, endColumn - 1),
    );
}

test("namen-ohne-begruendung: Namen mit einem Begründungswort als Wortteil werden gemeldet", () => {
  const quelltext = [
    "const fallsLeer = 1;",
    "const { weil, inhalt: wegenFrist } = quelle;",
    "function workaroundFuerZeit(sonstWert, [hackListe] = []) {}",
    "const pfeil = (otherwise_value) => otherwise_value;",
    "class TodoListe { fixmeFeld = 1; #damitPrivat = 2; becauseMethode() {} }",
    'const objekt = { "workaround-schalter": true, todo_zaehler: 0 };',
    "try { lauf(); } catch (fehlerWeil) {}",
    'import { wert as WEIL_WERT } from "./x.js";',
  ].join("\n");
  assert.deepEqual(gemeldeteNamen(quelltext), [
    "fallsLeer",
    "weil",
    "wegenFrist",
    "workaroundFuerZeit",
    "sonstWert",
    "hackListe",
    "otherwise_value",
    "TodoListe",
    "fixmeFeld",
    "#damitPrivat",
    "becauseMethode",
    '"workaround-schalter"',
    "todo_zaehler",
    "fehlerWeil",
    "WEIL_WERT",
  ]);
});

test("namen-ohne-begruendung: fallback, sinceMs, fehlergrund und Nutzungen bleiben frei", () => {
  const quelltext = [
    "const fallback = 1;",
    "const sinceMs = 2;",
    "const fehlergrund = 3;",
    "const hacker = 4;",
    "const kurz = { fallback };",
    "lauf(sonst.weil, falls);",
    'import { todo } from "node:test";',
  ].join("\n");
  assert.deepEqual(gemeldeteNamen(quelltext), []);
});

async function warnungenImRepo(quelltext, filePath) {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [ergebnis] = await eslint.lintText(quelltext, { filePath });
  return ergebnis.messages
    .filter(({ severity }) => severity === WARNUNG)
    .map(({ ruleId }) => ruleId);
}

test("die Repo-Konfiguration warnt bei einem Begründungsnamen in jeder Datei", async () => {
  const quelltext = "export const sonstLeer = [];\n";
  for (const filePath of ["src/probe-namen.js", "test/probe-namen.test.js", "tools/probe-namen.mjs"]) {
    assert.deepEqual(await warnungenImRepo(quelltext, filePath), [RULE], filePath);
  }
});

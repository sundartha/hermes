import assert from "node:assert/strict";
import { test } from "node:test";
import { ESLint } from "eslint";

import { REPO_ROOT } from "./probe-repo.js";

const RULE = "hermes/erster-import";
const STARTDATEIEN = ["src/server.js", "src/mcp-server.js"];

let repoEslint;

function eslint() {
  repoEslint ??= new ESLint({ cwd: REPO_ROOT });
  return repoEslint;
}

async function meldungen(filePath, zeilen) {
  const [ergebnis] = await eslint().lintText(`${zeilen.join("\n")}\n`, { filePath });
  return ergebnis.messages.filter(({ ruleId }) => ruleId === RULE).map(({ line }) => zeilen[line - 1] ?? "");
}

test("erster-import: die echten Startdateien laden die Prozess-Wächter zuerst", async () => {
  const ergebnisse = await eslint().lintFiles(STARTDATEIEN);
  assert.equal(ergebnisse.length, STARTDATEIEN.length);
  for (const { filePath, messages } of ergebnisse)
    assert.deepEqual(messages.filter(({ ruleId }) => ruleId === RULE), [], filePath);
});

test("erster-import: ein anderer Import vor den Prozess-Wächtern ist in beiden Startdateien rot", async () => {
  const zeilen = ['import { config } from "./config.js";', 'import "./process-guards.js";', "export { config };"];
  for (const datei of STARTDATEIEN)
    assert.deepEqual(await meldungen(datei, zeilen), ['import { config } from "./config.js";'], datei);
});

test("erster-import: fehlen die Prozess-Wächter ganz, ist die Startdatei rot", async () => {
  assert.deepEqual(await meldungen("src/server.js", ["export const ohne = 1;"]), ["export const ohne = 1;"]);
});

test("erster-import: gilt nur für die Startdateien", async () => {
  const zeilen = ['import { config } from "./config.js";', "export { config };"];
  assert.deepEqual(await meldungen("src/app.js", zeilen), []);
});

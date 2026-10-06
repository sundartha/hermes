import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Linter } from "eslint";

import hermes from "../../tools/eslint-rules/index.js";
import { ESLINT_BIN, REPO_ROOT, isolatedEnvironment, probeDirectory, writeFiles } from "./probe-repo.js";

const BASIS_VERGLEICH = join(REPO_ROOT, "tools/basis-vergleich.mjs");
const PLUGIN_URL = pathToFileURL(join(REPO_ROOT, "tools/eslint-rules/index.js")).href;
const JSON_INDENT = 2;
const EXIT_OK = 0;
const EXIT_FINDING = 1;

export function bestandsDatei(befunde) {
  return `${JSON.stringify({ befunde }, null, JSON_INDENT)}\n`;
}

export function gemeldeteZeilen({ directory, datei, regel, bestand, linterOptions = {} }, zeilen) {
  const linter = new Linter({ cwd: directory });
  const einstellung = bestand === undefined ? "error" : ["error", { bestand }];
  const config = { plugins: { hermes }, linterOptions, rules: { [regel]: einstellung } };
  const messages = linter.verify(zeilen.join("\n"), config, { filename: join(directory, datei) });
  return messages.filter(({ ruleId }) => ruleId === regel).map(({ line }) => zeilen[line - 1].trim());
}

export function eslintKonfiguration(konfiguration) {
  return [
    `import hermes from ${JSON.stringify(PLUGIN_URL)};`,
    `export default [{ plugins: { hermes }, ...${JSON.stringify(konfiguration)} }];`,
    "",
  ].join("\n");
}

function laufen(directory, programm, args) {
  const run = spawnSync(process.execPath, [programm, ...args], {
    cwd: directory,
    encoding: "utf8",
    env: isolatedEnvironment(),
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

export function bestandFriertGenauEin(context, { werkzeug, konfiguration, vorher, neu, ort }) {
  const directory = probeDirectory(context, {
    "eslint.config.mjs": eslintKonfiguration(konfiguration),
    ...vorher,
  });
  const angelegt = laufen(directory, BASIS_VERGLEICH, [werkzeug, "--basis-anlegen"]);
  assert.equal(angelegt.status, EXIT_OK, angelegt.output);
  assert.match(angelegt.output, /mit 1 Befunden angelegt/);
  assert.equal(laufen(directory, ESLINT_BIN, ["."]).status, EXIT_OK);
  writeFiles(directory, neu);
  const lint = laufen(directory, ESLINT_BIN, ["."]);
  assert.equal(lint.status, EXIT_FINDING, lint.output);
  const [regel] = Object.keys(konfiguration.rules);
  assert.ok(lint.output.includes(Object.keys(neu)[0]) && lint.output.includes(regel), lint.output);
  const vergleich = laufen(directory, BASIS_VERGLEICH, [werkzeug]);
  assert.equal(vergleich.status, EXIT_FINDING, vergleich.output);
  assert.ok(vergleich.output.includes(ort), vergleich.output);
}

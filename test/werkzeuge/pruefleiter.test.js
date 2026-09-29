import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AFFECTED_TESTS_TOOL,
  ESLINT_BIN,
  PRUEFLEITER_TOOL,
  failingTest,
  outputLines,
  passingTest,
  probeRepository,
  runIn,
} from "./probe-repo.js";

const MAX_GREEN_LINES = 3;
const MAX_LINT_LINES = 22;
const MANY_LINT_FINDINGS = 25;
const RED_TEST_MARKER = "roter betroffener Test";

function packageJson() {
  return JSON.stringify({
    name: "pruefleiter-probe",
    private: true,
    type: "module",
    scripts: {
      lint: `node ${JSON.stringify(ESLINT_BIN)} .`,
      "test:betroffen": `node ${JSON.stringify(AFFECTED_TESTS_TOOL)}`,
    },
  });
}

function probe(context) {
  return probeRepository(context, {
    "package.json": packageJson(),
    "eslint.config.js": 'export default [{ rules: { "no-debugger": "error" } }];\n',
    "src/basis.js": "export const wert = 1;\n",
    "src/rot.js": "export const rot = 1;\n",
    "test/basis.test.js": [
      'import { wert } from "../src/basis.js";',
      passingTest("gruener betroffener Test"),
    ].join("\n"),
    "test/rot.test.js": failingTest(RED_TEST_MARKER, "x", "../src/rot.js"),
  });
}

function runPruefleiter(directory) {
  return runIn(directory, process.execPath, [PRUEFLEITER_TOOL, "--basis", "HEAD"]);
}

function append(directory, path, text) {
  appendFileSync(join(directory, path), text);
}

test("ohne Verstoss ist die Pruefleiter gruen und bis auf eine Zeile still", (context) => {
  const directory = probe(context);
  append(directory, "src/basis.js", "export const geaendert = 2;\n");

  const result = runPruefleiter(directory);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(outputLines(result.stdout).length <= MAX_GREEN_LINES, result.stdout);
});

test("ein Lint-Verstoss macht die Pruefleiter rot und nennt die Fundstelle", (context) => {
  const directory = probe(context);
  append(directory, "src/basis.js", "debugger;\n");

  const result = runPruefleiter(directory);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /src\/basis\.js:2/);
});

test("viele Lint-Verstoesse zeigen hoechstens 20 Befunde", (context) => {
  const directory = probe(context);
  append(directory, "src/basis.js", "debugger;\n".repeat(MANY_LINT_FINDINGS));

  const result = runPruefleiter(directory);

  assert.notEqual(result.status, 0);
  assert.ok(outputLines(result.stdout).length <= MAX_LINT_LINES, result.stdout);
});

test("ein roter betroffener Test macht die Pruefleiter rot", (context) => {
  const directory = probe(context);
  append(directory, "src/rot.js", "export const geaendert = 2;\n");

  const result = runPruefleiter(directory);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, new RegExp(RED_TEST_MARKER));
});

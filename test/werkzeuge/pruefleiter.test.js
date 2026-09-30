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
const WORKFLOW_FILE = ".github/workflows/ci.yml";
const DEFAULT_BASE_REF = "refs/remotes/upstream/master";
const TOOL_TEST_MARKER = "roter Werkzeugtest";
const TOOL_TEST_FILE = "test/werkzeuge/werkzeug.test.js";
const TOOL_CHANGE_FILE = "tools/werkzeug.mjs";

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

function probe(context, extraFiles = {}) {
  return probeRepository(context, {
    ...extraFiles,
    "package.json": packageJson(),
    "eslint.config.js": 'export default [{ rules: { "no-debugger": "error" } }];\n',
    "src/basis.js": "export const wert = 1;\n",
    "src/rot.js": "export const rot = 1;\n",
    "test/basis.test.js": [
      'import { wert } from "../src/basis.js";',
      passingTest("gruener betroffener Test"),
    ].join("\n"),
    "test/rot.test.js": failingTest(RED_TEST_MARKER, "x", "../src/rot.js"),
    [WORKFLOW_FILE]: "name: CI\n",
  });
}

function runPruefleiter(directory) {
  return runIn(directory, process.execPath, [PRUEFLEITER_TOOL, "--basis", "HEAD"]);
}

function runPruefleiterWithoutBase(directory) {
  runIn(directory, "git", ["update-ref", DEFAULT_BASE_REF, "HEAD"]);
  return runIn(directory, process.execPath, [PRUEFLEITER_TOOL]);
}

function runBeforePush(directory, extraArgs = ["--basis", "HEAD"]) {
  return runIn(directory, process.execPath, [PRUEFLEITER_TOOL, "--vor-push", ...extraArgs]);
}

function runBeforePushWithDefaultBase(directory) {
  runIn(directory, "git", ["update-ref", DEFAULT_BASE_REF, "HEAD"]);
  return runBeforePush(directory, []);
}

function redToolTest() {
  return {
    [TOOL_TEST_FILE]: failingTest(TOOL_TEST_MARKER, "x"),
    [TOOL_CHANGE_FILE]: "export const werkzeug = 0;\n",
  };
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

test("mit Basis und einer Aenderung unter .github startet die Pruefleiter keinen Testlauf", (context) => {
  const directory = probe(context);
  append(directory, WORKFLOW_FILE, "on: push\n");

  const result = runPruefleiter(directory);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, new RegExp(RED_TEST_MARKER));
  assert.match(result.stdout, /volle Suite läuft im Job CI/);
});

test("ohne Basis faehrt die Pruefleiter bei einer Aenderung unter .github die volle Suite", (context) => {
  const directory = probe(context);
  append(directory, WORKFLOW_FILE, "on: push\n");

  const result = runPruefleiterWithoutBase(directory);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, new RegExp(RED_TEST_MARKER));
});

test("vor dem Push laeuft bei einer Aenderung unter .github kein Produkttest, aber die Werkzeugtests", (context) => {
  const directory = probe(context, redToolTest());
  append(directory, WORKFLOW_FILE, "on: push\n");

  const result = runBeforePush(directory);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, new RegExp(TOOL_TEST_MARKER));
  assert.doesNotMatch(result.stdout, new RegExp(RED_TEST_MARKER));
});

test("vor dem Push ist eine Aenderung unter .github mit gruenen Werkzeugtests gruen", (context) => {
  const directory = probe(context, { [TOOL_TEST_FILE]: passingTest("gruener Werkzeugtest") });
  append(directory, WORKFLOW_FILE, "on: push\n");

  const result = runBeforePush(directory);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /volle Suite läuft im Job CI/);
});

test("vor dem Push nutzt die Pruefleiter ohne --basis upstream/master und faehrt keine volle Suite", (context) => {
  const directory = probe(context, redToolTest());
  append(directory, TOOL_CHANGE_FILE, "export const geaendert = 1;\n");

  const result = runBeforePushWithDefaultBase(directory);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, new RegExp(TOOL_TEST_MARKER));
  assert.doesNotMatch(result.stdout, new RegExp(RED_TEST_MARKER));
});

test("vor dem Push faehrt eine Aenderung unter src die betroffenen Tests", (context) => {
  const directory = probe(context);
  append(directory, "src/rot.js", "export const geaendert = 2;\n");

  const result = runBeforePush(directory);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, new RegExp(RED_TEST_MARKER));
});

test("vor dem Push faehrt eine reine Aenderung unter src keine Werkzeugtests", (context) => {
  const directory = probe(context, redToolTest());
  append(directory, "src/basis.js", "export const geaendert = 2;\n");

  const result = runBeforePush(directory);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, new RegExp(TOOL_TEST_MARKER));
});

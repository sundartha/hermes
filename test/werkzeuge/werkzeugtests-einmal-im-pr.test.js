import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { isolatedEnvironment, probeDirectory, REPO_ROOT } from "./probe-repo.js";
import { workflowStepScript } from "./workflow-dateien.js";

const CI_TESTS = { file: "ci.yml", step: "Tests" };
const TOOL_TESTS = { file: "pruefleiter.yml", step: "Werkzeugtests" };
const CHECK_PARTS = { file: "pruefleiter.yml", step: "Alle Teile erfolgreich und vollständig" };
const WITHOUT_TOOL_TESTS = "--ohne-werkzeugtests";
const ALL_TOOL_TESTS = "--alle-werkzeugtests";
const ARGUMENTS_FILE = "npm-argumente.txt";
const SCRIPT_FILE = "schritt.sh";
const CHECKED_PART = 2;
const PARTS = 6;
const PART_ARGUMENT = `${CHECKED_PART}/${PARTS}`;
const SUITE_FILES = Array.from({ length: PARTS }, (_, index) => [`test/n${index + 1}.test.js`, `test/werkzeuge/w${index + 1}.test.js`]).flat();
const ROUND_ROBIN_PART_FILE = `test/n${CHECKED_PART}.test.js`;
const ROUND_ROBIN_PART_TOOL_FILE = `test/werkzeuge/w${CHECKED_PART}.test.js`;
const NPM_STUB = `#!/bin/sh\nprintf '%s\\n' "$@" > "$NPM_ARGUMENTE"\n`;

function stepDirectory(context, { file, step }) {
  const directory = probeDirectory(context, {
    npm: NPM_STUB,
    [SCRIPT_FILE]: workflowStepScript(file, step),
    [ARGUMENTS_FILE]: "",
    ...Object.fromEntries(SUITE_FILES.map((suiteFile) => [suiteFile, ""])),
  });
  chmodSync(join(directory, "npm"), 0o755);
  symlinkSync(join(REPO_ROOT, "tools"), join(directory, "tools"));
  return directory;
}

function stepEnvironment(directory, event) {
  return {
    ...isolatedEnvironment(),
    PATH: `${directory}:${process.env.PATH}`,
    NPM_ARGUMENTE: join(directory, ARGUMENTS_FILE),
    EVENT_NAME: event,
    PR_BASE_SHA: "basis",
    TEIL: String(CHECKED_PART),
    TEILE: String(PARTS),
    JOBS: "{}",
    RUNNER_TEMP: directory,
  };
}

function npmArguments(context, workflowStep, event) {
  const directory = stepDirectory(context, workflowStep);
  const result = spawnSync("bash", ["-e", join(directory, SCRIPT_FILE)], {
    cwd: directory,
    encoding: "utf8",
    env: stepEnvironment(directory, event),
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return readFileSync(join(directory, ARGUMENTS_FILE), "utf8").split("\n").filter((line) => line !== "");
}

function testRunnerArguments(argumentsList) {
  const separator = argumentsList.indexOf("--");
  assert.notEqual(separator, -1, argumentsList.join(" "));
  const runnerEnd = argumentsList.indexOf("--", separator + 1);
  assert.notEqual(runnerEnd, -1, argumentsList.join(" "));
  return argumentsList.slice(separator + 1, runnerEnd);
}

test("CI: im pull_request lassen die Testteile test/werkzeuge aus", (context) => {
  const argumentsList = npmArguments(context, CI_TESTS, "pull_request");

  assert.deepEqual(testRunnerArguments(argumentsList), [WITHOUT_TOOL_TESTS, ROUND_ROBIN_PART_FILE]);
});

test("CI: bei push auf master fahren die Testteile die volle Suite samt test/werkzeuge", (context) => {
  const argumentsList = npmArguments(context, CI_TESTS, "push");

  assert.deepEqual(testRunnerArguments(argumentsList), [ROUND_ROBIN_PART_FILE, ROUND_ROBIN_PART_TOOL_FILE]);
});

test("CI: in der Merge-Queue fahren die Testteile die volle Suite samt test/werkzeuge", (context) => {
  const argumentsList = npmArguments(context, CI_TESTS, "merge_group");

  assert.deepEqual(testRunnerArguments(argumentsList), [ROUND_ROBIN_PART_FILE, ROUND_ROBIN_PART_TOOL_FILE]);
});

test("Prüfleiter: im pull_request fahren die Werkzeugteile alle Werkzeugtests", (context) => {
  const argumentsList = npmArguments(context, TOOL_TESTS, "pull_request");

  assert.ok(argumentsList.includes(ALL_TOOL_TESTS), argumentsList.join(" "));
  assert.ok(argumentsList.includes(PART_ARGUMENT), argumentsList.join(" "));
});

test("Prüfleiter: im pull_request erwartet die Prüfung der Teile alle Werkzeugtests", (context) => {
  const argumentsList = npmArguments(context, CHECK_PARTS, "pull_request");

  assert.ok(argumentsList.includes(ALL_TOOL_TESTS), argumentsList.join(" "));
});

test("Prüfleiter: in der Merge-Queue entscheiden Werkzeugteile und Prüfung der Teile nach der Änderung", (context) => {
  const toolTests = npmArguments(context, TOOL_TESTS, "merge_group");
  const checkParts = npmArguments(context, CHECK_PARTS, "merge_group");

  assert.ok(!toolTests.includes(ALL_TOOL_TESTS), toolTests.join(" "));
  assert.ok(!checkParts.includes(ALL_TOOL_TESTS), checkParts.join(" "));
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { isolatedEnvironment, probeDirectory, probeRepository, REPO_ROOT, runIn } from "./probe-repo.js";
import { workflowStepScript } from "./workflow-dateien.js";

const CI_TESTS = { file: "ci.yml", step: "Tests", before: "Testdateien des Teils" };
const TOOL_TESTS = { file: "ci.yml", step: "Werkzeugtests" };
const CHECK_PARTS = { file: "ci.yml", step: "Alle Teile erfolgreich und vollständig" };
const WITHOUT_TOOL_TESTS = "--ohne-werkzeugtests";
const ALL_TOOL_TESTS = "--alle-werkzeugtests";
const EVENT_SELECTION = "--fuer-ereignis";
const ARGUMENTS_FILE = "npm-argumente.txt";
const SCRIPT_FILE = "schritt.sh";
const CHECKED_PART = 2;
const PARTS = 6;
const EIN_TEIL_FUER_ALLE_DATEIEN = "1";
const PART_ARGUMENT = `${CHECKED_PART}/${PARTS}`;
const SUITE_FILES = Array.from({ length: PARTS }, (_, index) => [`test/n${index + 1}.test.js`, `test/werkzeuge/w${index + 1}.test.js`]).flat();
const ROUND_ROBIN_PART_FILE = `test/n${CHECKED_PART}.test.js`;
const ROUND_ROBIN_PART_TOOL_FILE = `test/werkzeuge/w${CHECKED_PART}.test.js`;
const WERKZEUGTEST_LISTE = "tools/basis/werkzeugtests-mit-produkt.json";
const PRODUKT_DATEI = "src/basis.js";
const NPM_STUB = `#!/bin/sh\nprintf '%s\\n' "$@" > "$NPM_ARGUMENTE"\n`;

function stepScript({ file, step, before }) {
  const own = workflowStepScript(file, step);
  return before === undefined ? own : `${workflowStepScript(file, before)}\n${own}`;
}

function stepDirectory(context, workflowStep) {
  const directory = probeDirectory(context, {
    npm: NPM_STUB,
    [SCRIPT_FILE]: stepScript(workflowStep),
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

function npmArgumentsIn(context, workflowStep, { event, cwd, environment = {} }) {
  const directory = stepDirectory(context, workflowStep);
  const result = spawnSync("bash", ["-e", join(directory, SCRIPT_FILE)], {
    cwd: cwd ?? directory,
    encoding: "utf8",
    env: { ...stepEnvironment(directory, event), ...environment },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return readFileSync(join(directory, ARGUMENTS_FILE), "utf8").split("\n").filter((line) => line !== "");
}

function npmArguments(context, workflowStep, event) {
  return npmArgumentsIn(context, workflowStep, { event });
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

test("CI: in der Merge-Queue fahren die Testteile ohne erkennbaren Produkt-Stand die volle Suite samt test/werkzeuge", (context) => {
  const argumentsList = npmArguments(context, CI_TESTS, "merge_group");

  assert.deepEqual(testRunnerArguments(argumentsList), [ROUND_ROBIN_PART_FILE, ROUND_ROBIN_PART_TOOL_FILE]);
});

function queueRepository(context) {
  const repository = probeRepository(context, {
    [WERKZEUGTEST_LISTE]: JSON.stringify({ [ROUND_ROBIN_PART_TOOL_FILE]: "liest src/basis.js" }),
    [PRODUKT_DATEI]: "export const wert = 1;\n",
    ...Object.fromEntries(SUITE_FILES.map((suiteFile) => [suiteFile, ""])),
  });
  symlinkSync(join(REPO_ROOT, "tools/testlaufzeit"), join(repository, "tools/testlaufzeit"));
  const base = runIn(repository, "git", ["rev-parse", "HEAD"]).stdout.trim();
  appendFileSync(join(repository, PRODUKT_DATEI), "export const geaendert = 1;\n");
  return { repository, base };
}

test("CI: in der Merge-Queue fahren die Testteile bei einer reinen Produkt-Änderung gegenüber der echten Basis nur die gelistete Werkzeug-Testdatei", (context) => {
  const { repository, base } = queueRepository(context);
  const argumentsList = npmArgumentsIn(context, CI_TESTS, {
    event: "merge_group",
    cwd: repository,
    environment: { PR_BASE_SHA: base, TEIL: EIN_TEIL_FUER_ALLE_DATEIEN, TEILE: EIN_TEIL_FUER_ALLE_DATEIEN },
  });
  const productTests = SUITE_FILES.filter((suiteFile) => !suiteFile.startsWith("test/werkzeuge/"));
  assert.deepEqual(testRunnerArguments(argumentsList).toSorted(), [...productTests, ROUND_ROBIN_PART_TOOL_FILE].toSorted());
});

test("Werkzeugtests: im pull_request wählen die Werkzeugteile ohne Ereignisauswahl, also nur bei einer Werkzeug-Änderung und dann alle", (context) => {
  const argumentsList = npmArguments(context, TOOL_TESTS, "pull_request");

  assert.ok(!argumentsList.includes(EVENT_SELECTION), argumentsList.join(" "));
  assert.ok(!argumentsList.includes(WITHOUT_TOOL_TESTS), argumentsList.join(" "));
  assert.ok(argumentsList.includes(PART_ARGUMENT), argumentsList.join(" "));
});

test("Werkzeugtests: im pull_request erwartet die Prüfung der Teile dieselbe Auswahl wie die Werkzeugteile", (context) => {
  const argumentsList = npmArguments(context, CHECK_PARTS, "pull_request");

  assert.ok(!argumentsList.includes(EVENT_SELECTION), argumentsList.join(" "));
  assert.ok(!argumentsList.includes(WITHOUT_TOOL_TESTS), argumentsList.join(" "));
});

test("Werkzeugtests: in der Merge-Queue entscheiden Werkzeugteile und Prüfung der Teile nach der Änderung", (context) => {
  const toolTests = npmArguments(context, TOOL_TESTS, "merge_group");
  const checkParts = npmArguments(context, CHECK_PARTS, "merge_group");

  assert.ok(!toolTests.includes(ALL_TOOL_TESTS), toolTests.join(" "));
  assert.ok(!checkParts.includes(ALL_TOOL_TESTS), checkParts.join(" "));
});

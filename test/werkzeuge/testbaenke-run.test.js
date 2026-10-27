import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  REPO_ROOT,
  RUNNER,
  failingTest,
  outputLines,
  passingTest,
  probeDirectory,
  runIn,
} from "./probe-repo.js";

const MAX_GREEN_LINES = 3;
const MAX_RED_LINES = 30;
const MANY_FAILURES = 40;
const PROTOCOL_DIR = ".pruefung";
const MIGRATED_LIST = join(REPO_ROOT, "test/abnahme-ausgewandert.json");
const SHARD_TOTAL = 2;
const PASSED_COUNT = /^(\d+) bestanden/m;
const RESULT_FILE = join(PROTOCOL_DIR, "regression.json");
const GREEN_CASES = ["gruener Fall", "noch ein gruener Fall"];
const TOOL_TEST_FILE = "test/werkzeuge/rot.test.js";
const TOOL_TEST_MARKER = "roter Werkzeugtest";
const CRITERION_NAME = "ABNAHME-PROBE1: Kriterium im Unterordner | ROT WEIL: keiner | FIX: keiner";

function runBank(directory, bank) {
  return runIn(directory, process.execPath, [RUNNER, bank]);
}

function runRegressionBank(directory) {
  return runBank(directory, "regression");
}

function protocolFiles(directory) {
  return readdirSync(join(directory, PROTOCOL_DIR)).map((name) => join(PROTOCOL_DIR, name));
}

function manyFailingTests(count) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `for (let index = 0; index < ${count}; index++) {`,
    "  test(`roter Fall ${index}`, () => assert.equal(index, -1));",
    "}",
    "",
  ].join("\n");
}

test("ein gruener Lauf meldet sich in hoechstens drei Zeilen", (context) => {
  const directory = probeDirectory(context, {
    "test/gruen.test.js": passingTest("gruener Fall"),
    "test/unterordner/auch-gruen.test.js": passingTest("gruener Fall im Unterordner"),
  });

  const result = runRegressionBank(directory);

  assert.equal(result.status, 0, result.stdout);
  assert.ok(outputLines(result.stdout).length <= MAX_GREEN_LINES, result.stdout);
});

test("ein roter Fall im Unterordner nennt Name, Erwartung, Fundstelle und Protokoll", (context) => {
  const directory = probeDirectory(context, {
    "test/gruen.test.js": passingTest("gruener Nachbar"),
    "test/unterordner/rot.test.js": failingTest("roter Fall im Unterordner", "erwarteter-wert"),
  });

  const result = runRegressionBank(directory);

  assert.notEqual(result.status, 0);
  assert.ok(outputLines(result.stdout).length <= MAX_RED_LINES, result.stdout);
  assert.match(result.stdout, /roter Fall im Unterordner/);
  assert.match(result.stdout, /erwarteter-wert/);
  assert.match(result.stdout, /test\/unterordner\/rot\.test\.js/);
  const [protocol] = protocolFiles(directory).filter((path) => result.stdout.includes(path));
  assert.ok(protocol, `kein Protokollpfad in der Ausgabe: ${result.stdout}`);
  assert.match(readFileSync(join(directory, protocol), "utf8"), /gruener Nachbar/);
});

test("viele rote Faelle bleiben bei hoechstens 30 Zeilen", (context) => {
  const directory = probeDirectory(context, {
    "test/viele.test.js": manyFailingTests(MANY_FAILURES),
  });

  const result = runRegressionBank(directory);

  assert.notEqual(result.status, 0);
  assert.ok(outputLines(result.stdout).length <= MAX_RED_LINES, result.stdout);
  assert.match(result.stdout, /roter Fall 0/);
});

test("die Abnahme-Zahl zaehlt Testdateien in Unterordnern nicht als Kriterien", (context) => {
  const directory = probeDirectory(context, {
    "test/oben.test.js": passingTest("gewoehnlicher Test oben"),
    "test/unterordner/gewoehnlich.test.js": passingTest("gewoehnlicher Test im Unterordner"),
    "test/unterordner/kriterium.test.js": passingTest(CRITERION_NAME),
  });
  const criteria = JSON.parse(readFileSync(MIGRATED_LIST, "utf8")).length + 1;

  const result = runBank(directory, "abnahme");

  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, new RegExp(`^${criteria} von ${criteria} Abnahmekriterien erfuellt$`, "m"));
});

function passedCount(output) {
  return Number(PASSED_COUNT.exec(output)?.[1]);
}

function shardResults(directory, options = []) {
  const shards = Array.from({ length: SHARD_TOTAL }, (_unused, offset) => offset + 1);
  return shards.map((shard) =>
    runIn(directory, process.execPath, [RUNNER, "regression", ...options, "--", `--test-shard=${shard}/${SHARD_TOTAL}`]),
  );
}

function assertOnePassedPerShard(results) {
  for (const result of results) {
    assert.equal(result.status, 0, result.stdout);
    assert.equal(passedCount(result.stdout), 1, result.stdout);
  }
}

test("mit --test-shard faehrt jeder Teil nur seine Testdateien", (context) => {
  const directory = probeDirectory(context, {
    "test/erste.test.js": passingTest("erster Fall"),
    "test/zweite.test.js": passingTest("zweiter Fall"),
  });

  const results = shardResults(directory);

  assertOnePassedPerShard(results);
});

test("der Lauf hinterlegt die Zahl der bestandenen Tests maschinenlesbar", (context) => {
  const directory = probeDirectory(context, {
    "test/gruen.test.js": passingTest(GREEN_CASES[0]),
    "test/auch-gruen.test.js": passingTest(GREEN_CASES[1]),
    "test/rot.test.js": failingTest("roter Fall", "x"),
  });

  runRegressionBank(directory);

  const result = JSON.parse(readFileSync(join(directory, RESULT_FILE), "utf8"));
  assert.equal(result.bestanden, GREEN_CASES.length);
});

function suiteWithToolTest(context) {
  return probeDirectory(context, {
    "test/gruen.test.js": passingTest(GREEN_CASES[0]),
    "test/unterordner/auch-gruen.test.js": passingTest(GREEN_CASES[1]),
    [TOOL_TEST_FILE]: failingTest(TOOL_TEST_MARKER, "x"),
  });
}

test("mit --ohne-werkzeugtests faehrt die Regressionsbank alle Testdateien ausser denen unter test/werkzeuge", (context) => {
  const directory = suiteWithToolTest(context);

  const result = runIn(directory, process.execPath, [RUNNER, "regression", "--ohne-werkzeugtests"]);

  assert.equal(result.status, 0, result.stdout);
  assert.equal(passedCount(result.stdout), GREEN_CASES.length, result.stdout);
  assert.doesNotMatch(readFileSync(join(directory, PROTOCOL_DIR, "regression.log"), "utf8"), new RegExp(TOOL_TEST_MARKER));
});

test("ohne --ohne-werkzeugtests faehrt die Regressionsbank auch die Testdateien unter test/werkzeuge", (context) => {
  const directory = suiteWithToolTest(context);

  const result = runRegressionBank(directory);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, new RegExp(TOOL_TEST_MARKER));
});

test("mit --ohne-werkzeugtests teilt --test-shard die uebrigen Testdateien auf", (context) => {
  const directory = suiteWithToolTest(context);

  const results = shardResults(directory, ["--ohne-werkzeugtests"]);

  assertOnePassedPerShard(results);
});

test("mit --ohne-werkzeugtests faehrt ein Ordner als Argument nur seine Testdateien ausserhalb von test/werkzeuge", (context) => {
  const directory = suiteWithToolTest(context);

  const result = runIn(directory, process.execPath, [RUNNER, "regression", "--ohne-werkzeugtests", "test"]);

  assert.equal(result.status, 0, result.stdout);
  assert.equal(passedCount(result.stdout), GREEN_CASES.length, result.stdout);
});

test("mit --ohne-werkzeugtests bricht der Lauf ab, wenn ausserhalb von test/werkzeuge keine Testdatei uebrig bleibt", (context) => {
  const directory = suiteWithToolTest(context);

  const result = runIn(directory, process.execPath, [RUNNER, "regression", "--ohne-werkzeugtests", "test/werkzeuge/"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /keine Testdatei außerhalb von test\/werkzeuge\//);
  assert.doesNotMatch(result.stdout, new RegExp(TOOL_TEST_MARKER));
});

test("mit --ohne-werkzeugtests bricht der Lauf ab und nennt den Pfad, wenn ein angegebener Pfad keine Testdatei ergibt", (context) => {
  const directory = suiteWithToolTest(context);

  const result = runIn(directory, process.execPath, [RUNNER, "regression", "--ohne-werkzeugtests", "test/vertippt.test.js", "test"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /keine Testdatei unter test\/vertippt\.test\.js/);
  assert.doesNotMatch(result.stdout, PASSED_COUNT);
});

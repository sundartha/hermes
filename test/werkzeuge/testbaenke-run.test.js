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

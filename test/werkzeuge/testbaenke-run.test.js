import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  REPO_ROOT,
  RUNNER,
  failingTest,
  passingTest,
  probeDirectory,
  runIn,
} from "./probe-repo.js";

const MIGRATED_LIST = join(REPO_ROOT, "test/abnahme-ausgewandert.json");
const CRITERION_NAME = "ABNAHME-PROBE1: Kriterium im Unterordner | ROT WEIL: keiner | FIX: keiner";

function runBank(directory, bank) {
  return runIn(directory, process.execPath, [RUNNER, bank]);
}

test("ein roter Test im Unterordner macht den Lauf rot", (context) => {
  const directory = probeDirectory(context, {
    "test/gruen.test.js": passingTest("gruener Nachbar"),
    "test/unterordner/rot.test.js": failingTest("roter Fall im Unterordner", "erwarteter-wert"),
  });

  const result = runBank(directory, "regression");

  assert.notEqual(result.status, 0);
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

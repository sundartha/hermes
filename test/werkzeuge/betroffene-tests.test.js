import assert from "node:assert/strict";
import { appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AFFECTED_TESTS_TOOL,
  failingTest,
  probeRepository,
  runIn,
} from "./probe-repo.js";

const TWO_STEP_MARKER = "betroffen ueber zwei Stufen";
const UNRELATED_MARKER = "unbeteiligter Test";
const WEB_MARKER = "Web-Test";

const BASE_FILES = {
  "src/basis.js": "export const wert = 1;\n",
  "src/mitte.js": 'import { wert } from "./basis.js";\nexport const doppelt = wert + wert;\n',
  "src/allein.js": "export const allein = 1;\n",
  "test/betroffen.test.js": failingTest(TWO_STEP_MARKER, "x", "../src/mitte.js"),
  "test/unbeteiligt.test.js": failingTest(UNRELATED_MARKER, "x"),
  "apps/web/seite.txt": "Seite\n",
  "apps/web/test/web.test.js": failingTest(WEB_MARKER, "x"),
  "LIESMICH.txt": "Probe\n",
};

function runAffectedTests(directory) {
  return runIn(directory, process.execPath, [AFFECTED_TESTS_TOOL, "--basis", "HEAD"]);
}

function probeWithChange(context, change) {
  const directory = probeRepository(context, BASE_FILES);
  change(directory);
  return runAffectedTests(directory);
}

function changeFile(path) {
  return (directory) => appendFileSync(join(directory, path), "export const geaendert = 2;\n");
}

test("eine geaenderte Datei waehlt den Test, der sie ueber zwei Stufen importiert", (context) => {
  const result = probeWithChange(context, changeFile("src/basis.js"));

  assert.match(result.stdout, new RegExp(TWO_STEP_MARKER));
  assert.doesNotMatch(result.stdout, new RegExp(UNRELATED_MARKER));
  assert.doesNotMatch(result.stdout, new RegExp(WEB_MARKER));
});

test("eine geloeschte Datei faellt auf die volle Suite zurueck", (context) => {
  const result = probeWithChange(context, (directory) => rmSync(join(directory, "src/allein.js")));

  assert.match(result.stdout, new RegExp(TWO_STEP_MARKER));
  assert.match(result.stdout, new RegExp(UNRELATED_MARKER));
});

test("eine Aenderung ausserhalb von src und test faellt auf die volle Suite zurueck", (context) => {
  const result = probeWithChange(context, changeFile("LIESMICH.txt"));

  assert.match(result.stdout, new RegExp(TWO_STEP_MARKER));
  assert.match(result.stdout, new RegExp(UNRELATED_MARKER));
});

test("eine Datei, die kein Test erreicht, faellt auf die volle Suite zurueck", (context) => {
  const result = probeWithChange(context, changeFile("src/allein.js"));

  assert.match(result.stdout, new RegExp(TWO_STEP_MARKER));
  assert.match(result.stdout, new RegExp(UNRELATED_MARKER));
});

test("eine Aenderung unter apps/web laesst dessen Tests mitlaufen", (context) => {
  const result = probeWithChange(context, changeFile("apps/web/seite.txt"));

  assert.match(result.stdout, new RegExp(WEB_MARKER));
});

test("ohne Aenderung laeuft kein Test und der Lauf ist gruen", (context) => {
  const result = probeWithChange(context, () => {});

  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, new RegExp(UNRELATED_MARKER));
});

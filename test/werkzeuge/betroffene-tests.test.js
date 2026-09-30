import assert from "node:assert/strict";
import { appendFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
const EXPECTED_CONCURRENCY = 4;
const CONCURRENT_PROBE_FILES = EXPECTED_CONCURRENCY + 1;
const HOLD_MILLISECONDS = 5000;
const POLL_MILLISECONDS = 50;
const MARKS_DIRECTORY = "marken";
const PEAK_PREFIX = "hoechststand-";

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

function concurrencyProbe(index) {
  return [
    'import { mkdirSync, readdirSync, writeFileSync } from "node:fs";',
    'import { test } from "node:test";',
    'import { setTimeout as sleep } from "node:timers/promises";',
    "",
    `const marks = new URL("../${MARKS_DIRECTORY}/", import.meta.url);`,
    'const started = new URL("gestartet/", marks);',
    'const finished = new URL("beendet/", marks);',
    "const running = () => readdirSync(started).length - readdirSync(finished).length;",
    "",
    `test("gleichzeitig ${index}", async () => {`,
    "  mkdirSync(started, { recursive: true });",
    "  mkdirSync(finished, { recursive: true });",
    `  writeFileSync(new URL("${index}", started), "");`,
    `  const deadline = Date.now() + ${HOLD_MILLISECONDS};`,
    "  let peak = running();",
    `  while (peak <= ${EXPECTED_CONCURRENCY} && Date.now() < deadline) {`,
    `    await sleep(${POLL_MILLISECONDS});`,
    "    peak = Math.max(peak, running());",
    "  }",
    `  writeFileSync(new URL("${index}", finished), "");`,
    `  writeFileSync(new URL("${PEAK_PREFIX}${index}", marks), String(peak));`,
    "});",
    "",
  ].join("\n");
}

function concurrencyProbeFiles() {
  const indices = Array.from({ length: CONCURRENT_PROBE_FILES }, (_unused, offset) => offset + 1);
  const probes = indices.map((index) => [`test/gleichzeitig-${index}.test.js`, concurrencyProbe(index)]);
  return { ...Object.fromEntries(probes), "LIESMICH.txt": "Probe\n" };
}

function peakConcurrency(directory) {
  const marks = join(directory, MARKS_DIRECTORY);
  const peaks = readdirSync(marks)
    .filter((name) => name.startsWith(PEAK_PREFIX))
    .map((name) => Number(readFileSync(join(marks, name), "utf8")));
  return Math.max(...peaks);
}

test("beim Rueckfall auf die volle Suite laufen genau vier Testdateien gleichzeitig", (context) => {
  const directory = probeRepository(context, concurrencyProbeFiles());
  changeFile("LIESMICH.txt")(directory);

  const result = runAffectedTests(directory);

  assert.equal(result.status, 0, result.stdout);
  assert.equal(peakConcurrency(directory), EXPECTED_CONCURRENCY);
});

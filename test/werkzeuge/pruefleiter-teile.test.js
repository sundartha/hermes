import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AFFECTED_TESTS_TOOL,
  ESLINT_BIN,
  PRUEFLEITER_TOOL,
  failingTest,
  passingTest,
  probeRepository,
  runIn,
} from "./probe-repo.js";

const PARTS = 3;
const DUPLICATE_PART = PARTS + 1;
const TOOL_TEST_FILES = ["a", "b", "c", "d", "e"].map((name) => `test/werkzeuge/${name}.test.js`);
const RED_TOOL_TEST_FILE = "test/werkzeuge/c.test.js";
const RED_TOOL_TEST_MARKER = "roter Werkzeugtest im Teil";
const TOOL_CHANGE_FILE = "tools/werkzeug.mjs";
const PRODUCT_CHANGE_FILE = "src/basis.js";
const REPORT_DIRECTORY = ".pruefung";
const REPORT_PATTERN = /^werkzeugteil-\d+\.jsonl$/;
const ALL_GREEN = { vorpruefung: { result: "success" }, werkzeugtests: { result: "success" } };
const EXIT_USAGE = 2;
const EMPTY_PART = TOOL_TEST_FILES.length + 1;
const MEASURED_FILE = "tools/testlaufzeit/laufzeiten.json";
const HEAVIEST_MS = 900;
const SECOND_HEAVIEST_MS = 800;
const LIGHT_MS = [300, 300, 200];
const MEASURED_DURATIONS = Object.fromEntries(
  TOOL_TEST_FILES.map((file, index) => [file, [HEAVIEST_MS, SECOND_HEAVIEST_MS, ...LIGHT_MS][index]]),
);
const FOREIGN_TEST_FILE = "test/fremd.test.js";

function packageJson() {
  return JSON.stringify({
    name: "pruefleiter-teile-probe",
    private: true,
    type: "module",
    scripts: {
      lint: `node ${JSON.stringify(ESLINT_BIN)} .`,
      "test:betroffen": `node ${JSON.stringify(AFFECTED_TESTS_TOOL)}`,
    },
  });
}

function toolTestFiles(redFile) {
  return Object.fromEntries(
    TOOL_TEST_FILES.map((file) => [
      file,
      file === redFile
        ? failingTest(RED_TOOL_TEST_MARKER, "x")
        : passingTest(`Werkzeugtest in ${file}`),
    ]),
  );
}

function probe(context, { redFile, dauern } = {}) {
  return probeRepository(context, {
    ...toolTestFiles(redFile),
    ...(dauern === undefined ? {} : { [MEASURED_FILE]: JSON.stringify({ dauern }) }),
    "package.json": packageJson(),
    "eslint.config.js": 'export default [{ rules: { "no-debugger": "error" } }];\n',
    [PRODUCT_CHANGE_FILE]: "export const wert = 1;\n",
    "test/basis.test.js": [
      'import { wert } from "../src/basis.js";',
      passingTest("gruener betroffener Test"),
    ].join("\n"),
    [TOOL_CHANGE_FILE]: "export const werkzeug = 0;\n",
  });
}

function change(directory, path) {
  appendFileSync(join(directory, path), "export const geaendert = 1;\n");
}

function runPruefleiter(directory, args) {
  return runIn(directory, process.execPath, [PRUEFLEITER_TOOL, "--basis", "HEAD", ...args]);
}

function runParts(directory, extraArgs = []) {
  return Array.from({ length: PARTS }, (_, index) =>
    runPruefleiter(directory, ["--werkzeugteil", `${index + 1}/${PARTS}`, ...extraArgs]),
  );
}

function checkParts(directory, jobs = ALL_GREEN, extraArgs = []) {
  return runPruefleiter(directory, [
    "--teile-pruefen",
    REPORT_DIRECTORY,
    "--jobs",
    JSON.stringify(jobs),
    ...extraArgs,
  ]);
}

function reports(directory) {
  return readdirSync(join(directory, REPORT_DIRECTORY)).filter((name) => REPORT_PATTERN.test(name));
}

function filesIn(directory, report) {
  return readFileSync(join(directory, REPORT_DIRECTORY, report), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line).datei);
}

function assertEveryToolTestRanOnce(directory, results) {
  for (const result of results) assert.equal(result.status, 0, result.stdout + result.stderr);
  const ran = reports(directory).flatMap((report) => filesIn(directory, report));
  assert.deepEqual(ran.toSorted(), TOOL_TEST_FILES);
}

function partsWithToolChange(context, options) {
  const directory = probe(context, options);
  change(directory, TOOL_CHANGE_FILE);
  return { directory, results: runParts(directory) };
}

test("die Werkzeugteile fahren zusammen jede Werkzeug-Testdatei genau einmal, und die Prüfung der Teile ist grün", (context) => {
  const { directory, results } = partsWithToolChange(context);

  assertEveryToolTestRanOnce(directory, results);
  assert.equal(reports(directory).length, PARTS);
  const check = checkParts(directory);
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(
    check.stdout,
    new RegExp(`${TOOL_TEST_FILES.length} Werkzeug-Testdateien je genau einmal`),
  );
});

test("ein roter Werkzeugtest macht genau den Teil rot, in dem seine Datei läuft", (context) => {
  const { directory, results } = partsWithToolChange(context, { redFile: RED_TOOL_TEST_FILE });

  const red = results.filter((result) => result.status !== 0);
  assert.equal(red.length, 1);
  assert.match(red[0].stdout, new RegExp(RED_TOOL_TEST_MARKER));
  const redReport = reports(directory).find((report) =>
    filesIn(directory, report).includes(RED_TOOL_TEST_FILE),
  );
  assert.ok(redReport, "die rote Datei steht im Bericht ihres Teils");
});

test("die Prüfung der Teile ist rot, wenn ein Teil rot, abgebrochen oder übersprungen ist", (context) => {
  const { directory } = partsWithToolChange(context);

  for (const result of ["failure", "cancelled", "skipped"]) {
    const check = checkParts(directory, { ...ALL_GREEN, werkzeugtests: { result } });
    assert.notEqual(check.status, 0, result);
    assert.match(check.stdout, new RegExp(`Teil werkzeugtests: ${result}`));
  }
});

test("die Prüfung der Teile ist rot, wenn --jobs keinen Teil nennt", (context) => {
  const { directory } = partsWithToolChange(context);

  const check = checkParts(directory, {});

  assert.notEqual(check.status, 0);
  assert.match(check.stdout, /keinen Teil/);
});

test("die Prüfung der Teile ist rot, wenn eine Werkzeug-Testdatei in keinem Teil gelaufen ist", (context) => {
  const { directory } = partsWithToolChange(context);
  const missing = reports(directory).find((report) => filesIn(directory, report).length > 0);
  const lost = filesIn(directory, missing);
  rmSync(join(directory, REPORT_DIRECTORY, missing));

  const check = checkParts(directory);

  assert.notEqual(check.status, 0);
  for (const file of lost) assert.match(check.stdout, new RegExp(`${file}: in 0 Teilen gelaufen`));
});

test("die Prüfung der Teile ist rot, wenn eine Werkzeug-Testdatei in zwei Teilen gelaufen ist", (context) => {
  const { directory } = partsWithToolChange(context);
  const [first] = reports(directory);
  copyFileSync(
    join(directory, REPORT_DIRECTORY, first),
    join(directory, REPORT_DIRECTORY, `werkzeugteil-${DUPLICATE_PART}.jsonl`),
  );

  const check = checkParts(directory);

  assert.notEqual(check.status, 0);
  for (const file of filesIn(directory, first)) {
    assert.match(check.stdout, new RegExp(`${file}: in 2 Teilen gelaufen`));
  }
});

test("die Prüfung der Teile ist rot, wenn ein Teil eine Datei außerhalb der Werkzeugtests gefahren hat", (context) => {
  const { directory } = partsWithToolChange(context);
  const [first] = reports(directory);
  appendFileSync(
    join(directory, REPORT_DIRECTORY, first),
    `${JSON.stringify({ datei: FOREIGN_TEST_FILE })}\n`,
  );

  const check = checkParts(directory);

  assert.notEqual(check.status, 0);
  assert.match(
    check.stdout,
    new RegExp(`${FOREIGN_TEST_FILE}: in ${first} gelaufen, gehört aber nicht zu`),
  );
});

test("die Prüfung der Teile ist rot, wenn Werkzeugtests nötig sind, der Glob aber keine Datei findet", (context) => {
  const { directory } = partsWithToolChange(context);
  for (const file of TOOL_TEST_FILES) rmSync(join(directory, file));
  rmSync(join(directory, REPORT_DIRECTORY), { recursive: true });

  const check = checkParts(directory);

  assert.notEqual(check.status, 0);
  assert.match(check.stdout, /findet keine Werkzeug-Testdatei/);
});

test("bei einer reinen Änderung unter src läuft in keinem Teil ein Werkzeugtest, und die Prüfung der Teile ist grün", (context) => {
  const directory = probe(context, { redFile: RED_TOOL_TEST_FILE });
  change(directory, PRODUCT_CHANGE_FILE);

  const results = runParts(directory);

  for (const result of results) {
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(RED_TOOL_TEST_MARKER));
  }
  const check = checkParts(directory);
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test("ohne Werkzeugtests fährt die Pruefleiter Lint und betroffene Tests, aber keinen Werkzeugtest", (context) => {
  const directory = probe(context, { redFile: RED_TOOL_TEST_FILE });
  change(directory, TOOL_CHANGE_FILE);

  const green = runPruefleiter(directory, ["--ohne-werkzeugtests"]);
  appendFileSync(join(directory, TOOL_CHANGE_FILE), "debugger;\n");
  const red = runPruefleiter(directory, ["--ohne-werkzeugtests"]);

  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.doesNotMatch(green.stdout, new RegExp(RED_TOOL_TEST_MARKER));
  assert.notEqual(red.status, 0);
  assert.match(red.stdout, /no-debugger/);
});

test("ein ungültiger Teil oder zwei Arten auf einmal brechen mit Nutzungsfehler ab", (context) => {
  const directory = probe(context);

  for (const args of [
    ["--werkzeugteil", "3/2"],
    ["--werkzeugteil", "0/2"],
    ["--werkzeugteil", "1/2", "--ohne-werkzeugtests"],
    ["--teile-pruefen", REPORT_DIRECTORY],
  ]) {
    const result = runPruefleiter(directory, args);
    assert.equal(result.status, EXIT_USAGE, args.join(" "));
  }
});

const ALL_TOOL_TESTS = "--alle-werkzeugtests";

function partsWithAllToolTests(context) {
  const directory = probe(context);
  change(directory, PRODUCT_CHANGE_FILE);
  return { directory, results: runParts(directory, [ALL_TOOL_TESTS]) };
}

test("mit --alle-werkzeugtests fahren die Teile auch bei einer reinen Änderung unter src jede Werkzeug-Testdatei genau einmal", (context) => {
  const { directory, results } = partsWithAllToolTests(context);

  assertEveryToolTestRanOnce(directory, results);
  const check = checkParts(directory, ALL_GREEN, [ALL_TOOL_TESTS]);
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test("mit --alle-werkzeugtests ist die Prüfung der Teile rot, wenn die Teile bei einer reinen Änderung unter src keinen Werkzeugtest gefahren haben", (context) => {
  const directory = probe(context);
  change(directory, PRODUCT_CHANGE_FILE);
  for (const result of runParts(directory)) assert.equal(result.status, 0, result.stdout + result.stderr);

  const check = checkParts(directory, ALL_GREEN, [ALL_TOOL_TESTS]);

  assert.notEqual(check.status, 0);
  for (const file of TOOL_TEST_FILES) assert.match(check.stdout, new RegExp(`${file}: in 0 Teilen gelaufen`));
});

test("mit --alle-werkzeugtests fährt der Gesamtlauf auch bei einer reinen Änderung unter src die Werkzeugtests", (context) => {
  const directory = probe(context, { redFile: RED_TOOL_TEST_FILE });
  change(directory, PRODUCT_CHANGE_FILE);

  const withoutOption = runPruefleiter(directory, []);
  const withOption = runPruefleiter(directory, [ALL_TOOL_TESTS]);

  assert.equal(withoutOption.status, 0, withoutOption.stdout + withoutOption.stderr);
  assert.doesNotMatch(withoutOption.stdout, new RegExp(RED_TOOL_TEST_MARKER));
  assert.notEqual(withOption.status, 0);
  assert.match(withOption.stdout, new RegExp(RED_TOOL_TEST_MARKER));
});

test("die Werkzeugteile verteilen die Dateien nach der gemessenen Dauer, und die Prüfung der Teile bleibt grün", (context) => {
  const directory = probe(context, { dauern: MEASURED_DURATIONS });
  change(directory, TOOL_CHANGE_FILE);
  const results = runParts(directory);

  assertEveryToolTestRanOnce(directory, results);
  assert.deepEqual(filesIn(directory, "werkzeugteil-1.jsonl"), [TOOL_TEST_FILES[0]]);
  assert.deepEqual(filesIn(directory, "werkzeugteil-2.jsonl"), [TOOL_TEST_FILES[1]]);
  assert.deepEqual(filesIn(directory, "werkzeugteil-3.jsonl").toSorted(), TOOL_TEST_FILES.slice(2));
  const check = checkParts(directory);
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test("ein Werkzeugteil ohne Datei endet rot und fährt nicht die ganze Suite", (context) => {
  const directory = probe(context);
  change(directory, TOOL_CHANGE_FILE);

  const result = runPruefleiter(directory, ["--werkzeugteil", `${EMPTY_PART}/${EMPTY_PART}`]);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /enthält keine Testdatei/);
  assert.ok(!existsSync(join(directory, REPORT_DIRECTORY, `werkzeugteil-${EMPTY_PART}.jsonl`)));
});

function partWithFileList(context, lines) {
  const directory = probe(context);
  change(directory, TOOL_CHANGE_FILE);
  writeFileSync(join(directory, "werkzeugdateien.txt"), lines.map((line) => `${line}\n`).join(""));
  const result = runPruefleiter(directory, ["--werkzeugteil", `1/${PARTS}`, "--werkzeugdateien", "werkzeugdateien.txt"]);
  return { directory, result };
}

test("ein Werkzeugteil mit --werkzeugdateien fährt genau die genannten Dateien", (context) => {
  const { directory, result } = partWithFileList(context, [TOOL_TEST_FILES[1]]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(filesIn(directory, "werkzeugteil-1.jsonl"), [TOOL_TEST_FILES[1]]);
});

test("ein Werkzeugteil mit leerer --werkzeugdateien-Liste fährt nichts und bleibt grün", (context) => {
  const { directory, result } = partWithFileList(context, []);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(directory, REPORT_DIRECTORY, "werkzeugteil-1.jsonl")), false);
});

test("--werkzeugdateien ohne --werkzeugteil ist ein Aufruffehler", (context) => {
  const directory = probe(context);

  const result = runPruefleiter(directory, ["--werkzeugdateien", "werkzeugdateien.txt"]);

  assert.equal(result.status, EXIT_USAGE);
});

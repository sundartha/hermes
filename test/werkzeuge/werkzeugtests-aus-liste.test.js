import assert from "node:assert/strict";
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  failingTest,
  outputLines,
  passingTest,
  PRUEFLEITER_TOOL,
  probeRepository,
  REPO_ROOT,
  runIn,
} from "./probe-repo.js";

const PARTS = 2;
const LIST_FILE = "tools/basis/werkzeugtests-mit-produkt.json";
const LISTED_FILE = "test/werkzeuge/gelistet.test.js";
const FREE_FILES = ["test/werkzeuge/frei-a.test.js", "test/werkzeuge/frei-b.test.js"];
const ALL_TOOL_TEST_FILES = [LISTED_FILE, ...FREE_FILES].toSorted();
const PRODUCT_FILE = "src/basis.js";
const HARNESS_FILE = "test/testbaenke-run.mjs";
const REPORT_DIRECTORY = ".pruefung";
const REPORT_PATTERN = /^werkzeugteil-\d+\.jsonl$/;
const ALL_GREEN = { vorpruefung: { result: "success" }, werkzeugtests: { result: "success" } };
const LISTED_OPTION = "--werkzeugtests-aus-liste";
const EXIT_USAGE = 2;
const PART_FILES_TOOL = join(REPO_ROOT, "tools/testlaufzeit/teil-dateien.mjs");
const PRODUCT_TEST_FILE = "test/basis.test.js";
const PRODUCT_READER_MARKER = "liest src und bleibt grün ohne Fehler";
const RED_LISTED_MARKER = "gelisteter Werkzeugtest sieht den Fehler";
const PRODUCT_READER_NOTICE = "liest Produktcode, gehört in werkzeugtests-mit-produkt.json oder auf ein Beispiel-Repo";

function readsProduct(name) {
  return [
    'import assert from "node:assert/strict";',
    'import { readFileSync } from "node:fs";',
    'import { test } from "node:test";',
    `test(${JSON.stringify(name)}, () => {`,
    '  assert.doesNotMatch(readFileSync("src/basis.js", "utf8"), /kaputt/);',
    "});",
    "",
  ].join("\n");
}

function listText(files) {
  return JSON.stringify(Object.fromEntries(files.map((file) => [file, "liest src/basis.js"])));
}

function probe(context, { listed = [LISTED_FILE], extraFiles = {} } = {}) {
  const listFiles = listed === null ? {} : { [LIST_FILE]: listText(listed) };
  return probeRepository(context, {
    "package.json": JSON.stringify({ name: "aus-liste-probe", private: true, type: "module" }),
    ...listFiles,
    [PRODUCT_FILE]: "export const wert = 1;\n",
    [PRODUCT_TEST_FILE]: passingTest("gruener Produkttest"),
    [HARNESS_FILE]: "export const harness = 1;\n",
    [LISTED_FILE]: readsProduct(RED_LISTED_MARKER),
    [FREE_FILES[0]]: passingTest("freier Werkzeugtest a"),
    [FREE_FILES[1]]: passingTest("freier Werkzeugtest b"),
    ...extraFiles,
  });
}

function change(directory, path) {
  appendFileSync(join(directory, path), "export const kaputt = 1;\n");
}

function runPruefleiter(directory, args) {
  return runIn(directory, process.execPath, [PRUEFLEITER_TOOL, "--basis", "HEAD", ...args]);
}

function runParts(directory, extraArgs = [LISTED_OPTION]) {
  return Array.from({ length: PARTS }, (_, index) =>
    runPruefleiter(directory, ["--werkzeugteil", `${index + 1}/${PARTS}`, ...extraArgs]),
  );
}

function checkParts(directory, extraArgs = [LISTED_OPTION]) {
  return runPruefleiter(directory, [
    "--teile-pruefen",
    REPORT_DIRECTORY,
    "--jobs",
    JSON.stringify(ALL_GREEN),
    ...extraArgs,
  ]);
}

function reportsIn(directory) {
  const reportDirectory = join(directory, REPORT_DIRECTORY);
  return readdirSync(reportDirectory)
    .filter((name) => REPORT_PATTERN.test(name))
    .map((name) => join(reportDirectory, name));
}

function reportedFiles(report) {
  return outputLines(readFileSync(report, "utf8")).map((line) => JSON.parse(line).datei);
}

function filesThatRan(directory) {
  return reportsIn(directory).flatMap(reportedFiles).toSorted();
}

function assertAllGreen(results) {
  for (const result of results) assert.equal(result.status, 0, result.stdout + result.stderr);
}

function output(results) {
  return results.map(({ stdout, stderr }) => stdout + stderr).join("\n");
}

test("bei einer reinen Änderung unter src fahren die Teile nur die gelistete Werkzeug-Testdatei", (context) => {
  const directory = probe(context, { extraFiles: { [LISTED_FILE]: passingTest("gelisteter Werkzeugtest") } });
  change(directory, PRODUCT_FILE);

  const results = runParts(directory);

  assertAllGreen(results);
  assert.deepEqual(filesThatRan(directory), [LISTED_FILE]);
  const check = checkParts(directory);
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /1 Werkzeug-Testdateien je genau einmal/);
});

test("ein roter gelisteter Werkzeugtest macht die Teile bei einer reinen Änderung unter src rot", (context) => {
  const directory = probe(context);
  change(directory, PRODUCT_FILE);

  const results = runParts(directory);

  assert.ok(results.some(({ status }) => status !== 0));
  assert.match(output(results), new RegExp(RED_LISTED_MARKER));
  assert.deepEqual(filesThatRan(directory), [LISTED_FILE]);
});

test("ohne Änderung unter src bleibt derselbe gelistete Werkzeugtest grün", (context) => {
  const directory = probe(context);
  change(directory, PRODUCT_TEST_FILE);

  assertAllGreen(runParts(directory));
});

test("eine Änderung am Test-Harness wählt alle Werkzeug-Testdateien", (context) => {
  const directory = probe(context);
  change(directory, HARNESS_FILE);

  assertAllGreen(runParts(directory));

  assert.deepEqual(filesThatRan(directory), ALL_TOOL_TEST_FILES);
  const check = checkParts(directory);
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test("eine Änderung an der Liste wählt alle Werkzeug-Testdateien", (context) => {
  const directory = probe(context);
  writeFileSync(join(directory, LIST_FILE), listText([LISTED_FILE, FREE_FILES[0]]));

  assertAllGreen(runParts(directory));

  assert.deepEqual(filesThatRan(directory), ALL_TOOL_TEST_FILES);
});

test("eine Änderung an einem Werkzeug wählt alle Werkzeug-Testdateien", (context) => {
  const directory = probe(context, { extraFiles: { "tools/werkzeug.mjs": "export const werkzeug = 0;\n" } });
  change(directory, "tools/werkzeug.mjs");

  assertAllGreen(runParts(directory));

  assert.deepEqual(filesThatRan(directory), ALL_TOOL_TEST_FILES);
});

test("fehlt die Liste, fahren die Teile bei einer reinen Änderung unter src alle Werkzeug-Testdateien", (context) => {
  const directory = probe(context, { listed: null });
  change(directory, PRODUCT_FILE);

  const results = runParts(directory);

  assert.ok(results.some(({ status }) => status !== 0));
  assert.deepEqual(filesThatRan(directory), ALL_TOOL_TEST_FILES);
});

test("nennt die Liste eine Datei, die es nicht gibt, fahren die Teile alle Werkzeug-Testdateien", (context) => {
  const directory = probe(context, { listed: [LISTED_FILE, "test/werkzeuge/gibt-es-nicht.test.js"] });
  change(directory, PRODUCT_FILE);

  const results = runParts(directory);

  assert.match(output(results), new RegExp(RED_LISTED_MARKER));
  assert.deepEqual(filesThatRan(directory), ALL_TOOL_TEST_FILES);
});

test("der Wächter macht eine Werkzeug-Testdatei rot, die Produktcode liest und nicht in der Liste steht", (context) => {
  const directory = probe(context, {
    listed: [],
    extraFiles: { "tools/werkzeug.mjs": "export const werkzeug = 0;\n" },
  });
  change(directory, "tools/werkzeug.mjs");

  const results = runParts(directory);

  assert.ok(results.some(({ status }) => status !== 0));
  assert.match(output(results), new RegExp(`${LISTED_FILE}: ${PRODUCT_READER_NOTICE}`));
  assert.doesNotMatch(output(results), new RegExp(`${FREE_FILES[0]}: ${PRODUCT_READER_NOTICE}`));
});

test("derselbe Test in der Liste besteht den Wächter", (context) => {
  const directory = probe(context, {
    extraFiles: { "tools/werkzeug.mjs": "export const werkzeug = 0;\n", [LISTED_FILE]: readsProduct(PRODUCT_READER_MARKER) },
  });
  change(directory, "tools/werkzeug.mjs");

  assertAllGreen(runParts(directory));
});

test("ein Werkzeugtest außerhalb der Liste, der auch mit Produktcode rot ist, bekommt keinen Hinweis auf Produktcode", (context) => {
  const directory = probe(context, {
    listed: [],
    extraFiles: {
      "tools/werkzeug.mjs": "export const werkzeug = 0;\n",
      [LISTED_FILE]: passingTest("gruen"),
      [FREE_FILES[0]]: failingTest("roter freier Werkzeugtest", "x"),
    },
  });
  change(directory, "tools/werkzeug.mjs");

  const results = runParts(directory);

  assert.ok(results.some(({ status }) => status !== 0));
  assert.match(output(results), /roter freier Werkzeugtest/);
  assert.doesNotMatch(output(results), new RegExp(PRODUCT_READER_NOTICE));
});

test("der Wächter lässt außerhalb der Liste nur test/werkzeuge und den Test-Harness sehen", (context) => {
  const probeTest = [
    'import assert from "node:assert/strict";',
    'import { existsSync, readdirSync } from "node:fs";',
    'import { test } from "node:test";',
    'test("sichtbarer Baum", () => {',
    '  assert.equal(existsSync("src"), false);',
    '  assert.equal(existsSync(".git"), false);',
    '  assert.deepEqual(readdirSync("test").toSorted(), ["testbaenke-run.mjs", "werkzeuge"]);',
    '  assert.equal(existsSync("tools/werkzeug.mjs"), true);',
    "});",
    "",
  ].join("\n");
  const directory = probe(context, {
    listed: [],
    extraFiles: {
      "tools/werkzeug.mjs": "export const werkzeug = 0;\n",
      [LISTED_FILE]: passingTest("gruen"),
      [FREE_FILES[0]]: probeTest,
    },
  });
  change(directory, "tools/werkzeug.mjs");

  assertAllGreen(runParts(directory));
});

function selectedPartFiles(directory) {
  const result = runIn(directory, process.execPath, [
    PART_FILES_TOOL, "--teil", "1", "--teile", "1", LISTED_OPTION, "--basis", "HEAD",
  ]);
  assert.equal(result.status, 0, result.stderr);
  return outputLines(result.stdout).toSorted();
}

test("die Dateien der Teile bei einer reinen Änderung unter src sind alle Produkttests und die gelistete Werkzeug-Testdatei", (context) => {
  const directory = probe(context);
  change(directory, PRODUCT_FILE);

  assert.deepEqual(selectedPartFiles(directory), [PRODUCT_TEST_FILE, LISTED_FILE].toSorted());
});

test("die Dateien der Teile bei einer Änderung am Werkzeug sind alle Testdateien", (context) => {
  const directory = probe(context, { extraFiles: { "tools/werkzeug.mjs": "export const werkzeug = 0;\n" } });
  change(directory, "tools/werkzeug.mjs");

  assert.deepEqual(selectedPartFiles(directory), [PRODUCT_TEST_FILE, ...ALL_TOOL_TEST_FILES].toSorted());
});

test("ohne Basis oder zusammen mit --ohne-werkzeugtests bricht die Auswahl der Teile mit Nutzungsfehler ab", (context) => {
  const directory = probe(context);

  for (const args of [[LISTED_OPTION], [LISTED_OPTION, "--basis", "HEAD", "--ohne-werkzeugtests"]]) {
    const result = runIn(directory, process.execPath, [PART_FILES_TOOL, "--teil", "1", "--teile", "1", ...args]);
    assert.equal(result.status, EXIT_USAGE, args.join(" "));
  }
});

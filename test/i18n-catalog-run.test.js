import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countPhantomWrapperEntries,
  extraArgsFrom,
  parseNodeSummary,
  patternFlagFor,
} from "./i18n-catalog-run.mjs";

const FILE_WITH_REMAINING_TEST = [
  "# Subtest: normal test",
  "ok 1 - normal test",
].join("\n");

const FILE_FULLY_FILTERED_BY_PATTERN = [
  "1..0",
  "# Subtest: test/bar.test.js",
  "ok 2 - test/bar.test.js",
].join("\n");

const FILE_ACTUALLY_EMPTY = [
  "# Subtest: test/leer.test.js",
  "ok 3 - test/leer.test.js",
].join("\n");

test("countPhantomWrapperEntries: Datei mit verbleibendem Test zaehlt in keinem Modus als Phantom", () => {
  assert.equal(countPhantomWrapperEntries(FILE_WITH_REMAINING_TEST, "regression"), 0);
  assert.equal(countPhantomWrapperEntries(FILE_WITH_REMAINING_TEST, "gates"), 0);
});

test("countPhantomWrapperEntries: durch Muster komplett leergefilterte Datei (1..0 davor) zaehlt in beiden Modi", () => {
  assert.equal(countPhantomWrapperEntries(FILE_FULLY_FILTERED_BY_PATTERN, "regression"), 1);
  assert.equal(countPhantomWrapperEntries(FILE_FULLY_FILTERED_BY_PATTERN, "gates"), 1);
});

test("countPhantomWrapperEntries: echt leere Datei (ohne 1..0 davor) zaehlt NUR im Gates-Lauf", () => {
  assert.equal(countPhantomWrapperEntries(FILE_ACTUALLY_EMPTY, "regression"), 0);
  assert.equal(countPhantomWrapperEntries(FILE_ACTUALLY_EMPTY, "gates"), 1);
});

test("countPhantomWrapperEntries: mehrere Datei-Wrapper werden unabhaengig gezaehlt", () => {
  const combined = [
    FILE_WITH_REMAINING_TEST,
    FILE_FULLY_FILTERED_BY_PATTERN,
    FILE_ACTUALLY_EMPTY,
  ].join("\n");
  assert.equal(countPhantomWrapperEntries(combined, "regression"), 1);
  assert.equal(countPhantomWrapperEntries(combined, "gates"), 2);
});

test("parseNodeSummary: liest tests/pass/fail aus den TAP-Summenzeilen", () => {
  const tap = ["# tests 42", "# pass 40", "# fail 2"].join("\n");
  assert.deepEqual(parseNodeSummary(tap), { tests: 42, pass: 40, fail: 2 });
});

test("parseNodeSummary: liefert null bei abgebrochenem Lauf ohne vollstaendige Summe", () => {
  const tap = ["# tests 42", "# pass 40"].join("\n");
  assert.equal(parseNodeSummary(tap), null);
});

test("patternFlagFor: gates nutzt --test-name-pattern, regression --test-skip-pattern, beide mit demselben Muster", () => {
  const gatesFlag = patternFlagFor("gates");
  const regressionFlag = patternFlagFor("regression");
  assert.match(gatesFlag, /^--test-name-pattern=/);
  assert.match(regressionFlag, /^--test-skip-pattern=/);
  const gatesPattern = gatesFlag.slice("--test-name-pattern=".length);
  const regressionPattern = regressionFlag.slice("--test-skip-pattern=".length);
  assert.equal(gatesPattern, regressionPattern);
});

test("extraArgsFrom: ohne '--'-Trenner keine zusaetzlichen Flags", () => {
  const argv = ["node", "test/i18n-catalog-run.mjs", "regression"];
  assert.deepEqual(extraArgsFrom(argv), []);
});

test("extraArgsFrom: alles nach '--' geht unveraendert durch (CI-Coverage-Gate-Anwendungsfall)", () => {
  const argv = [
    "node",
    "test/i18n-catalog-run.mjs",
    "regression",
    "--",
    "--experimental-test-coverage",
    "--test-coverage-lines=81",
  ];
  assert.deepEqual(extraArgsFrom(argv), [
    "--experimental-test-coverage",
    "--test-coverage-lines=81",
  ]);
});

test("package.json config.i18nCatalogPattern ist ein gueltiger, nicht-leerer Regex-String", async () => {
  const { default: pkg } = await import("../package.json", { with: { type: "json" } });
  const pattern = pkg.config?.i18nCatalogPattern;
  assert.equal(typeof pattern, "string");
  assert.ok(pattern.length > 0);
  assert.doesNotThrow(() => new RegExp(pattern));
});

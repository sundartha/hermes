import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as bank from "../testbaenke-run.mjs";

const OHNE_GRENZE = [
  ".github/workflows/ci.yml",
  ".github/workflows/freigabe.yml",
  ".github/workflows/node-erkennung.yml",
  ".github/workflows/testschutz.yml",
];

for (const datei of OHNE_GRENZE) {
  test(`${datei} bricht keinen Job an einer Zeitgrenze ab`, () => {
    assert.doesNotMatch(readFileSync(datei, "utf8"), /timeout-minutes/);
  });
}

test("Testbank setzt ohne TESTS_DATEIGRENZE_S keine Dateigrenze", () => {
  const argumente = bank.nodeTestArguments("regression", [], ["test/a.test.js"], {});
  assert.deepEqual(argumente.filter((argument) => argument.startsWith("--test-timeout")), []);
  assert.ok(argumente.includes("test/a.test.js"));
});

test("Testbank hält eine ausdrücklich gesetzte Dateigrenze ein, ohne sie zu kappen", () => {
  const argumente = bank.nodeTestArguments("regression", [], ["test/a.test.js"], { TESTS_DATEIGRENZE_S: "5000" });
  assert.ok(argumente.includes("--test-timeout=5000000"));
});

test("die Prüfung setzt für Mutationsläufe keine Dateigrenze mehr", () => {
  assert.doesNotMatch(readFileSync("tools/pruefen.mjs", "utf8"), /DATEIGRENZE/);
});

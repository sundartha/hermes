import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const WURZEL = new URL("../../", import.meta.url);

function lies(pfad) {
  return readFileSync(new URL(pfad, WURZEL), "utf8");
}

const WORKFLOWS = ["ci", "freigabe", "node-erkennung", "testschutz"];

for (const name of WORKFLOWS) {
  test(`${name}.yml bricht keinen Job an einer Zeitgrenze ab`, () => {
    const zeilen = lies(`.github/workflows/${name}.yml`)
      .split("\n")
      .filter((zeile) => /^\s*timeout-minutes:/.test(zeile));
    assert.deepEqual(zeilen, []);
  });
}

test("die Auslieferungs-Workflows behalten ihre Zeitgrenzen", () => {
  for (const name of ["live", "staging", "notfall"]) {
    assert.match(lies(`.github/workflows/${name}.yml`), /^\s*timeout-minutes: \d+$/m);
  }
});

test("die Testbank setzt keine Dateigrenze, auch nicht über die Umgebung", () => {
  const bank = lies("test/testbaenke-run.mjs");
  assert.doesNotMatch(bank, /--test-timeout/);
  assert.doesNotMatch(bank, /TESTS_DATEIGRENZE_S/);
});

test("die Mutationsprüfung gibt ihren Testläufen keine Dateigrenze mit", () => {
  assert.doesNotMatch(lies("tools/pruefen.mjs"), /TESTS_DATEIGRENZE_S|TESTFRIST_S/);
});

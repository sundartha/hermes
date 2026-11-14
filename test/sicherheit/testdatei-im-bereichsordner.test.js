import assert from "node:assert/strict";
import test from "node:test";

import { Linter } from "eslint";

import testRegeln from "../../tools/eslint-rules/tests.js";

function befunde(datei) {
  const konfiguration = [
    {
      files: ["**/*.js", "**/*.mjs", "**/*.ts"],
      plugins: { x: { rules: { bereich: testRegeln.rules["testdatei-im-bereich"] } } },
      rules: { "x/bereich": "error" },
      languageOptions: { sourceType: "module", ecmaVersion: "latest" },
    },
  ];
  return new Linter().verify("export const a = 1;\n", konfiguration, datei).filter((meldung) => meldung.ruleId === "x/bereich");
}

const FAELLE = [
  ["test/neu.test.js", 1],
  ["test/neu.test.mjs", 1],
  ["test/neu.test.ts", 1],
  ["test/anrufe/neu.test.js", 0],
  ["test/sicherheit/neu.test.js", 0],
  ["test/helpers.js", 0],
  ["test/gemeinsam/hilfe.mjs", 0],
];

for (const [datei, erwartet] of FAELLE) {
  test(`Testdatei im Bereichsordner: ${datei} hat ${erwartet} Befunde`, () => {
    assert.equal(befunde(datei).length, erwartet);
  });
}

test("Testdatei im Bereichsordner: die Meldung nennt die Bereiche aus tools/bereiche.json", () => {
  const [befund] = befunde("test/neu.test.js");
  assert.match(befund.message, /test\/<bereich>\/<name>\.test\.js/);
  assert.match(befund.message, /rueckfrage, posteingang, abrechnung/);
  assert.match(befund.message, /website-onboarding/);
});

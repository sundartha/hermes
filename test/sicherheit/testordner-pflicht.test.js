import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { ESLint } from "eslint";

const WURZEL = resolve(import.meta.dirname, "../..");
const REGEL = "hermes-tests/test-nur-im-bereichsordner";

async function befunde(datei) {
  const eslint = new ESLint({ cwd: WURZEL });
  const [ergebnis] = await eslint.lintText('import test from "node:test";\ntest("x", () => {});\n', { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === REGEL);
}

test("Eine neue Testdatei direkt in test/ ist ein Befund und nennt die Bereiche", async () => {
  const gefunden = await befunde("test/neu.test.js");
  assert.equal(gefunden.length, 1);
  assert.match(gefunden[0].message, /test\/<bereich>\/<name>\.test\.js/);
  assert.equal((await befunde("test/neu.test.mjs")).length, 1);
  assert.match(gefunden[0].message, /Bereiche aus tools\/bereiche\.json: .*rueckfrage, posteingang, abrechnung/);
});

test("Eine neue Testdatei in test/<bereich>/ ist kein Befund", async () => {
  assert.equal((await befunde("test/sicherheit/neu.test.js")).length, 0);
  assert.equal((await befunde("test/rueckfrage/neu.test.mjs")).length, 0);
});

test("Eine Hilfsdatei direkt in test/ ist kein Befund", async () => {
  assert.equal((await befunde("test/helpers.js")).length, 0);
  assert.equal((await befunde("test/hilfe.mjs")).length, 0);
});

test("Eine Testdatei tiefer unter test/ ist kein Befund", async () => {
  assert.equal((await befunde("test/sicherheit/tief/neu.test.js")).length, 0);
});

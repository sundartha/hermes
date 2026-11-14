import assert from "node:assert/strict";
import { test } from "node:test";

import { neueVerstoesse } from "../../tools/pruefen.mjs";

const REGEL = "tests-nur-ueber-eingaenge";
const ZIEL_X = "src/i18n/inbound-x.ts";
const ZIEL_Y = "src/i18n/inbound-y.ts";

function verstoss(test, ziel) {
  return `${REGEL}: ${test} → ${ziel}`;
}

test("Eine in einen Bereichsordner verschobene Testdatei, die eine .ts-Datei importiert, bleibt derselbe Verstoß", () => {
  const master = [verstoss("test/iel-init-webhook.test.js", ZIEL_X)];
  const kopf = [verstoss("test/i18n/iel-init-webhook.test.js", ZIEL_X)];
  assert.deepEqual(neueVerstoesse(master, kopf), []);
});

test("Ein verschobener Test, der eine .ts-Datei importiert, die es auf master nicht gab, bleibt neu", () => {
  const master = [verstoss("test/iel-init-webhook.test.js", ZIEL_X)];
  const neu = verstoss("test/i18n/iel-init-webhook.test.js", ZIEL_Y);
  const kopf = [verstoss("test/i18n/iel-init-webhook.test.js", ZIEL_X), neu];
  assert.deepEqual(neueVerstoesse(master, kopf), [neu]);
});

test("Eine verschobene .ts-Testdatei, die eine .ts-Datei importiert, bleibt derselbe Verstoß", () => {
  const master = [verstoss("test/x.test.js", ZIEL_X)];
  const kopf = [verstoss("test/i18n/x.test.ts", ZIEL_X)];
  assert.deepEqual(neueVerstoesse(master, kopf), []);
});

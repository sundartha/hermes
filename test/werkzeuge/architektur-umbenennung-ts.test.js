import assert from "node:assert/strict";
import { test } from "node:test";

import { gewachseneEintraege } from "../../tools/pruefen.mjs";

const VERSTOSS = "speicher-nur-ueber-fassade: src/sms-summary.ts → src/store/views";

function stand(...namen) {
  return new Map(namen.map((name) => [`|${name}`, 1]));
}

test("Ein .ts-Importeur, dessen Ziel von .js nach .ts umbenannt wurde, bleibt derselbe Verstoß", () => {
  const vorher = stand(`${VERSTOSS}.js`);
  const jetzt = stand(`${VERSTOSS}.ts`);
  assert.deepEqual(gewachseneEintraege(vorher, jetzt), []);
});

test("Ein Verstoß zu einem Ziel, das es auf master nicht gab, bleibt neu", () => {
  const vorher = stand(`${VERSTOSS}.js`);
  const jetzt = stand(`${VERSTOSS}.ts`, "speicher-nur-ueber-fassade: src/sms-summary.ts → src/store/anderes.ts");
  assert.deepEqual(gewachseneEintraege(vorher, jetzt), ["speicher-nur-ueber-fassade: src/sms-summary.ts → src/store/anderes.ts"]);
});

test("Zwei Verstöße, die auf denselben master-Verstoß passen, verbrauchen ihn nur einmal", () => {
  const vorher = stand(`${VERSTOSS}.js`);
  const jetzt = stand(`${VERSTOSS}.ts`, "speicher-nur-ueber-fassade: src/sms-summary.js → src/store/views.ts");
  assert.equal(gewachseneEintraege(vorher, jetzt).length, 1);
});

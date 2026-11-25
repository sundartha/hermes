import assert from "node:assert/strict";
import { test } from "node:test";

import * as ergebnis from "../../src/utils/ergebnis.ts";

const FAELLE = [
  { name: "Zahl", wert: 5 },
  { name: "Text", wert: "x" },
  { name: "null", wert: null },
  { name: "Objekt", wert: { a: 1 } },
];

for (const { name, wert } of FAELLE) {
  test(`ergebnis: ok(${name}) trägt den Wert`, () => {
    assert.deepEqual(ergebnis.ok(wert), { ok: true, wert });
  });
  test(`ergebnis: fehler(${name}) trägt den Fehler`, () => {
    assert.deepEqual(ergebnis.fehler(wert), { ok: false, fehler: wert });
  });
}

import assert from "node:assert/strict";
import { test } from "node:test";

import { enthaelt } from "../../tools/quelllage.mjs";

function lage(zeile, spalte) {
  return { line: zeile, column: spalte };
}

function bereich(von, bis) {
  return { start: lage(...von), end: lage(...bis) };
}

const AUSSEN = bereich([3, 4], [6, 2]);

const FAELLE = [
  { fall: "innen liegt ganz in der Mitte", innen: bereich([4, 0], [5, 9]), erwartet: true },
  { fall: "innen ist derselbe Bereich", innen: bereich([3, 4], [6, 2]), erwartet: true },
  { fall: "innen ist ein Punkt auf dem Anfang von außen", innen: bereich([3, 4], [3, 4]), erwartet: true },
  { fall: "innen ist ein Punkt auf dem Ende von außen", innen: bereich([6, 2], [6, 2]), erwartet: true },
  { fall: "innen beginnt in derselben Zeile eine Spalte früher", innen: bereich([3, 3], [4, 0]), erwartet: false },
  { fall: "innen beginnt in derselben Zeile eine Spalte später", innen: bereich([3, 5], [4, 0]), erwartet: true },
  { fall: "innen endet in derselben Zeile eine Spalte später", innen: bereich([4, 0], [6, 3]), erwartet: false },
  { fall: "innen endet in derselben Zeile eine Spalte früher", innen: bereich([4, 0], [6, 1]), erwartet: true },
  { fall: "innen beginnt in einer früheren Zeile", innen: bereich([2, 9], [4, 0]), erwartet: false },
  { fall: "innen endet in einer späteren Zeile", innen: bereich([4, 0], [7, 0]), erwartet: false },
  { fall: "innen liegt ganz vor außen", innen: bereich([1, 0], [2, 0]), erwartet: false },
  { fall: "innen liegt ganz hinter außen", innen: bereich([8, 0], [9, 0]), erwartet: false },
  { fall: "außen liegt innerhalb von innen", innen: bereich([1, 0], [9, 0]), erwartet: false },
];

for (const { fall, innen, erwartet } of FAELLE) {
  test(`quelllage: ${fall}`, () => {
    assert.equal(enthaelt(AUSSEN, innen), erwartet);
  });
}

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

function pruefeAlle(faelle, erwartet) {
  for (const [fall, innen] of Object.entries(faelle)) {
    assert.equal(enthaelt(AUSSEN, innen), erwartet, fall);
  }
}

test("quelllage: ein Bereich in der Mitte, auf den Grenzen oder gleich außen ist enthalten", () => {
  pruefeAlle(
    {
      "ganz in der Mitte": bereich([4, 0], [5, 9]),
      "derselbe Bereich": bereich([3, 4], [6, 2]),
      "Punkt auf dem Anfang von außen": bereich([3, 4], [3, 4]),
      "Punkt auf dem Ende von außen": bereich([6, 2], [6, 2]),
      "Anfang eine Spalte nach außen-Anfang": bereich([3, 5], [4, 0]),
      "Ende eine Spalte vor außen-Ende": bereich([4, 0], [6, 1]),
    },
    true,
  );
});

test("quelllage: ein Bereich, der vor dem Anfang von außen beginnt, ist nicht enthalten", () => {
  pruefeAlle(
    {
      "eine Spalte früher in derselben Zeile": bereich([3, 3], [4, 0]),
      "eine Zeile früher bei größerer Spalte": bereich([2, 9], [4, 0]),
      "ganz davor": bereich([1, 0], [2, 0]),
      "umschließt außen ganz": bereich([1, 0], [9, 0]),
    },
    false,
  );
});

test("quelllage: ein Bereich, der hinter dem Ende von außen endet, ist nicht enthalten", () => {
  pruefeAlle(
    {
      "eine Spalte später in derselben Zeile": bereich([4, 0], [6, 3]),
      "eine Zeile später bei kleinerer Spalte": bereich([4, 0], [7, 0]),
      "ganz dahinter": bereich([8, 0], [9, 0]),
    },
    false,
  );
});

test("quelllage: enthält außen den inneren Bereich, gilt das nicht umgekehrt", () => {
  const innen = bereich([4, 0], [5, 9]);
  assert.equal(enthaelt(AUSSEN, innen), true);
  assert.equal(enthaelt(innen, AUSSEN), false);
});

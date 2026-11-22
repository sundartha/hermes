import assert from "node:assert/strict";
import { test } from "node:test";

import { mutantKandidaten, mutantReihenfolge } from "../../tools/pruefen.mjs";

const dateien = (anzahl) => Array.from({ length: anzahl }, (_, nr) => `test/x/t${String(nr).padStart(4, "0")}.test.js`);

test("langsame Testdateien (gemessene Dauer ab 60 s) laufen zuletzt und fallen nicht unter die Obergrenze", () => {
  const tests = dateien(5);
  const dauer = { [tests[0]]: 61_000, [tests[1]]: 59_000 };
  assert.deepEqual(mutantReihenfolge({ tests, dauer }, "").slice(-1), [tests[0]]);
  assert.deepEqual(mutantReihenfolge({ tests, geaendert: [tests[0]], dauer }, "")[0], tests[0]);
  const { auswahl } = mutantKandidaten({ tests, dauer }, "", 2);
  assert.deepEqual(auswahl, [tests[1], tests[2], tests[0]]);
});

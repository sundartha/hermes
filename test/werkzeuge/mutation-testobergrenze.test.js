import assert from "node:assert/strict";
import { test } from "node:test";

import { mutantKandidaten } from "../../tools/pruefen.mjs";

const dateien = (anzahl) => Array.from({ length: anzahl }, (_, nr) => `test/x/t${String(nr).padStart(4, "0")}.test.js`);

test("301 Kandidaten werden auf 300 gekürzt und der Vermerk nennt beide Zahlen", () => {
  const { auswahl, kandidaten } = mutantKandidaten({ tests: dateien(301), geaendert: [] }, "", 300);
  assert.equal(auswahl.length, 300);
  assert.equal(kandidaten, 301);
  assert.deepEqual(auswahl, dateien(300));
});

test("300 und 299 Kandidaten bleiben ungekürzt", () => {
  assert.equal(mutantKandidaten({ tests: dateien(300), geaendert: [] }, "", 300).auswahl.length, 300);
  const { auswahl, kandidaten } = mutantKandidaten({ tests: dateien(299), geaendert: [] }, "", 300);
  assert.equal(auswahl.length, 299);
  assert.equal(kandidaten, 299);
});

test("geänderte Testdateien laufen immer mit, auch hinter Platz 300", () => {
  const tests = dateien(500);
  const geaendert = [tests[400], tests[450]];
  const { auswahl } = mutantKandidaten({ tests, geaendert }, "", 300);
  assert.ok(auswahl.includes(tests[400]));
  assert.ok(auswahl.includes(tests[450]));
  assert.ok(auswahl.length <= 302);
});

test("mehr geänderte Testdateien als die Obergrenze laufen alle", () => {
  const tests = dateien(20);
  const { auswahl } = mutantKandidaten({ tests, geaendert: tests.slice(10) }, "", 3);
  assert.equal(auswahl.length, 10);
  assert.ok(tests.slice(10).every((datei) => auswahl.includes(datei)));
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { hilfsdateiBefunde } from "../../tools/testlaufzeit/hilfsdatei.mjs";

const zeileFuer = (datei) => ({ datei });

const TESTDATEI = zeileFuer("test/x.test.js");
const HILFSDATEI = zeileFuer("test/x-helfer.js");

test("eine Zeile für eine Hilfsdatei ist ein Befund", () => {
  assert.deepEqual(hilfsdateiBefunde([TESTDATEI, HILFSDATEI]), [
    "Testfälle in test/x-helfer.js: test() gehört in die Testdatei, sonst zählt die Laufzeit falsch",
  ]);
});

test("nur Zeilen für .test.js-Dateien sind kein Befund", () => {
  assert.deepEqual(hilfsdateiBefunde([TESTDATEI, zeileFuer("test/werkzeuge/y.test.js")]), []);
});

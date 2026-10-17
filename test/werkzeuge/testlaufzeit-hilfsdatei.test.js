import assert from "node:assert/strict";
import { test } from "node:test";

import { hilfsdateiBefunde } from "../../tools/testlaufzeit/hilfsdatei.mjs";

const TESTDATEI = { datei: "test/x.test.js", dauer_ms: 12, ausklingen_ms: 3 };
const HILFSDATEI = { datei: "test/x-helfer.js", dauer_ms: null, ausklingen_ms: null };

test("eine Zeile für eine Hilfsdatei ist ein Befund", () => {
  assert.deepEqual(hilfsdateiBefunde([TESTDATEI, HILFSDATEI]), [
    "Testfälle in test/x-helfer.js: test() gehört in die Testdatei, sonst zählt die Laufzeit falsch",
  ]);
});

test("nur Zeilen für .test.js-Dateien sind kein Befund", () => {
  assert.deepEqual(
    hilfsdateiBefunde([TESTDATEI, { ...TESTDATEI, datei: "test/werkzeuge/y.test.js" }]),
    [],
  );
});

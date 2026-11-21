import assert from "node:assert/strict";
import { test } from "node:test";

import { strykerKonfiguration } from "../../tools/pruefen.mjs";

test("Die Stryker-Konfiguration lässt Dateien unter src/ ohne @ts-nocheck-Kopf", () => {
  const konfiguration = strykerKonfiguration(["src/a.js:1-2"], "bericht.json");
  assert.equal(konfiguration.disableTypeChecks, false);
  assert.equal(konfiguration.inPlace, true);
  assert.deepEqual(konfiguration.mutate, ["src/a.js:1-2"]);
  assert.equal(konfiguration.jsonReporter.fileName, "bericht.json");
});

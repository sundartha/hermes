import assert from "node:assert/strict";
import { test } from "node:test";

import { LESEFEHLER, startMitFremdemAnruf } from "./2973-h7c2b4b1-start-helfer.js";

test("H7c2b4b1-4: scheitert das Lesen der Anrufe fuer die Abdeckung, bricht der Start ab ohne Abdeckungszahl", async () => {
  const { fehler, lauscht, zeilen } = await startMitFremdemAnruf({ scheiternAb: 2 });
  assert.equal(fehler?.message, LESEFEHLER);
  assert.equal(lauscht, 0);
  assert.doesNotMatch(zeilen, /Abgleich-Deckung/);
});


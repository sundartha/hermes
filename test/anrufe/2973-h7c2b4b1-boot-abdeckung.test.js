import assert from "node:assert/strict";
import { test } from "node:test";

import { startMitFremdemAnruf } from "./2973-h7c2b4b1-start-helfer.js";

test("H7c2b4b1-3: der Start zaehlt einen Anruf, den nur die Datenbank kennt, in die Abdeckung", async () => {
  const { fehler, zeilen } = await startMitFremdemAnruf();
  assert.equal(fehler, undefined);
  assert.match(zeilen, /Abgleich-Deckung 100%/);
});

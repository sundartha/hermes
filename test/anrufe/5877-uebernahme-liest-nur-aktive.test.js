import assert from "node:assert/strict";
import { test } from "node:test";

import { GELESENE_ANFRAGEN, LESEN_VOR_DEN_RUECKFRAGEN, startMitDatenbank } from "./2973-h7b-start-helfer.js";

test("5877-1: die Uebernahme verwaister Arbeit liest nur die aktiven Anrufe, nicht den Berichtsweg mit allem Verlauf", async () => {
  const { fehler } = await startMitDatenbank(Infinity);
  assert.equal(fehler, undefined);
  const uebernahme = GELESENE_ANFRAGEN[LESEN_VOR_DEN_RUECKFRAGEN - 1];
  assert.match(uebernahme, /status = 'active'/);
  assert.doesNotMatch(uebernahme, /DESC/);
});

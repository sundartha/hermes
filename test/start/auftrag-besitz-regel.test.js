import assert from "node:assert/strict";
import { test } from "node:test";

import * as speicher from "../../src/store.js";

const FREMD = "fremd-host:00000000-0000-4000-8000-000000000021";
const EIGENE = "eigene-host:00000000-0000-4000-8000-000000000022";
const ANDERE = "andere-host:00000000-0000-4000-8000-000000000023";

const REGEL_TABELLE = [
  { name: "lebender Fremder", besitzer: FREMD, lage: { eigene: EIGENE, lebende: [FREMD, EIGENE] }, erwartet: "fremd" },
  { name: "die eigene Kennung", besitzer: EIGENE, lage: { eigene: EIGENE, lebende: [FREMD] }, erwartet: null },
  { name: "die eigene Kennung bei unlesbarem Lebenszeichen", besitzer: EIGENE, lage: { eigene: EIGENE, lebende: null }, erwartet: null },
  { name: "Fremder ohne Lebenszeichen", besitzer: FREMD, lage: { eigene: EIGENE, lebende: [ANDERE] }, erwartet: null },
  { name: "niemand lebt", besitzer: FREMD, lage: { eigene: EIGENE, lebende: [] }, erwartet: null },
  { name: "kein Besitzer", besitzer: null, lage: { eigene: EIGENE, lebende: [FREMD] }, erwartet: null },
  { name: "kein Besitzer bei unlesbarem Lebenszeichen", besitzer: null, lage: { eigene: EIGENE, lebende: null }, erwartet: null },
  { name: "leerer Besitzer bei unlesbarem Lebenszeichen", besitzer: "", lage: { eigene: EIGENE, lebende: null }, erwartet: null },
  { name: "Fremder bei unlesbarem Lebenszeichen", besitzer: FREMD, lage: { eigene: EIGENE, lebende: null }, erwartet: "lebenszeichen_unlesbar" },
  { name: "Lebende sind kein Feld", besitzer: FREMD, lage: { eigene: EIGENE, lebende: FREMD }, erwartet: "lebenszeichen_unlesbar" },
];

test("Auftrag-Besitz: ein Nummernkauf-Auftrag wird bei lebendem Fremden und bei unlesbarem Lebenszeichen gehalten, sonst uebernommen", () => {
  for (const { name, besitzer, lage, erwartet } of REGEL_TABELLE) {
    assert.equal(speicher.auftragHaltGrund(besitzer, lage), erwartet, name);
  }
});

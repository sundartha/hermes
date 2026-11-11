import assert from "node:assert/strict";
import { test } from "node:test";

import * as speicher from "../../src/store.js";

const FREMD = "fremd-host:00000000-0000-4000-8000-000000000003";
const EIGENE = "eigene-host:00000000-0000-4000-8000-000000000004";
const ANDERE = "andere-host:00000000-0000-4000-8000-000000000005";

const REGEL_TABELLE = [
  { name: "lebender Fremder", besitzer: FREMD, lage: { eigene: EIGENE, lebende: [FREMD, EIGENE] }, erwartet: true },
  { name: "die eigene Kennung", besitzer: EIGENE, lage: { eigene: EIGENE, lebende: [FREMD, EIGENE] }, erwartet: false },
  { name: "Fremder ohne Lebenszeichen", besitzer: FREMD, lage: { eigene: EIGENE, lebende: [ANDERE] }, erwartet: false },
  { name: "kein Besitzer eingetragen", besitzer: null, lage: { eigene: EIGENE, lebende: [FREMD] }, erwartet: false },
  { name: "leerer Besitzer", besitzer: "", lage: { eigene: EIGENE, lebende: [FREMD, ""] }, erwartet: false },
  { name: "Lebenszeichen unlesbar", besitzer: FREMD, lage: { eigene: EIGENE, lebende: null }, erwartet: false },
  { name: "Lebende sind kein Feld", besitzer: FREMD, lage: { eigene: EIGENE, lebende: FREMD }, erwartet: false },
  { name: "niemand lebt", besitzer: FREMD, lage: { eigene: EIGENE, lebende: [] }, erwartet: false },
];

test("Regel: die Arbeit gehoert nur einem lebenden Fremden, wenn Besitzer, eigene Kennung und Lebende es zeigen", () => {
  for (const { name, besitzer, lage, erwartet } of REGEL_TABELLE) {
    assert.equal(speicher.arbeitGehoertLebenderFremder(besitzer, lage), erwartet, name);
  }
});

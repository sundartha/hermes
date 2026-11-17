import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const karte = JSON.parse(readFileSync(new URL("../../tools/bausteine.json", import.meta.url), "utf8"));
const baustein = (name) => karte.bausteine.find((eintrag) => eintrag.baustein === name);

test("posteingang-importrichtung: anrufe importiert nichts mehr aus posteingang, der Bestand führt das Paar nicht mehr", () => {
  const paar = karte.altlast.find((eintrag) => eintrag.von === "anrufe" && eintrag.nach === "posteingang");
  assert.equal(paar, undefined);
});

for (const datei of ["src/mail-summary.ts", "src/mail-not-placed.ts"]) {
  test(`posteingang-importrichtung: ${datei} gehört zu anrufe, nicht mehr zu posteingang und ist kein Eingang`, () => {
    assert.equal(baustein("posteingang").quellen.includes(datei), false);
    assert.equal(baustein("posteingang").eingaenge.includes(datei), false);
    assert.equal(baustein("anrufe").quellen.includes(datei), true);
    assert.equal(baustein("anrufe").eingaenge.includes(datei), false);
  });
}

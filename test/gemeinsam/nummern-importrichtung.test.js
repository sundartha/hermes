import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const karte = JSON.parse(readFileSync(new URL("../../tools/bausteine.json", import.meta.url), "utf8"));
const baustein = (name) => karte.bausteine.find((eintrag) => eintrag.baustein === name);

test("nummern-importrichtung: anrufe importiert nichts mehr aus nummern, der Bestand führt das Paar nicht mehr", () => {
  const paar = karte.altlast.find((eintrag) => eintrag.von === "anrufe" && eintrag.nach === "nummern");
  assert.equal(paar, undefined);
});

for (const datei of ["src/telephony/adapters/telnyx/numbers.js"]) {
  test(`nummern-importrichtung: ${datei} gehört zu anrufe, nicht mehr zu nummern und ist kein Eingang`, () => {
    assert.equal(baustein("nummern").quellen.includes(datei), false);
    assert.equal(baustein("nummern").eingaenge.includes(datei), false);
    assert.equal(baustein("anrufe").eingaenge.includes(datei), false);
  });
}

test("nummern-importrichtung: der Fehler 'Nummer gekauft, ID offen' liegt in begriffe und trägt Nummer und Ursache", async () => {
  const { NummerGekauftIdOffen } = await import("../../src/begriffe/nummern-vergabe.ts");
  const ursache = new Error("keine ID");
  const fehler = new NummerGekauftIdOffen("+4930123456", ursache);
  assert.equal(fehler.name, "NummerGekauftIdOffen");
  assert.equal(fehler.e164, "+4930123456");
  assert.equal(fehler.message, "Telnyx orderNumber: Nummer gekauft, Nummern-ID offen (keine ID)");
  assert.equal(fehler.cause, ursache);
  assert.ok(fehler instanceof Error);
});

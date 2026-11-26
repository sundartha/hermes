import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const karte = JSON.parse(readFileSync(new URL("../../tools/bausteine.json", import.meta.url), "utf8"));

test("posteingang-importrichtung: anrufe importiert nichts mehr aus posteingang, der Bestand führt das Paar nicht mehr", () => {
  const paar = karte.altlast.find((eintrag) => eintrag.von === "anrufe" && eintrag.nach === "posteingang");
  assert.equal(paar, undefined);
});

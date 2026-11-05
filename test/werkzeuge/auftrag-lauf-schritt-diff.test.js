import assert from "node:assert/strict";
import { test } from "node:test";

import { ROTER_TEST, VERDOPPELT, funktion, pruefung } from "./auftrag-lauf-hilfen.js";
import { BASIS, EXIT_ROT, starte } from "./auftrag-lauf-probe.js";

const PRODUKT_IM_TEST = "Der Test-Agent hat Produktcode geändert: src/text.js";
const GEAENDERTER_TEXT = `${BASIS["src/text.js"]}export const X = 1;\n`;

test("ändert der Test-Agent im Schritt eine src-Datei, ist der Schritt ungültig, egal wie er sie schrieb", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST, "src/text.js": GEAENDERTER_TEXT }, bau: { "src/rechnen.js": VERDOPPELT } };
  const { lauf, beleg, basis, kopf } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.ergebnis, "rot");
  assert.ok(beleg.runden[0].startsWith("Runde 1: grenzen test endete mit Exit 1."), beleg.runden[0]);
  assert.ok(beleg.runden[0].includes(`Verstoß: ${PRODUKT_IM_TEST}`), beleg.runden[0]);
  assert.equal(kopf, basis);
});

test("ein normaler Auftrag, in dem der Test-Agent nur Tests und der Bau-Agent nur Produktcode ändert, ist gültig", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };
  const { lauf, beleg, basis, kopf } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(pruefung(beleg, "grenzen test"), 0, JSON.stringify(beleg.pruefungen));
  assert.equal(pruefung(beleg, "grenzen bau"), 0, JSON.stringify(beleg.pruefungen));
  assert.notEqual(kopf, basis);
});

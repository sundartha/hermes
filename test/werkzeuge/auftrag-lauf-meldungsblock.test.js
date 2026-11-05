import assert from "node:assert/strict";
import { test } from "node:test";

import { KOPIEN_LISTE, MIT_MUTATION, ROTER_TEST, VERDOPPELT } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, TESTUMBAU, starte } from "./auftrag-lauf-probe.js";

const BLOCK = "Meldungsblock | ";
const GESAMT_ZEILEN = 100;

function erstlaufRotMit(meldungszeilen) {
  return [
    'console.error("Abbruch: Erstlauf rot: test/rechnen.test.js › verdopple > sieben");',
    `for (const zeile of ${JSON.stringify(meldungszeilen)}) console.error("${BLOCK}" + zeile);`,
    'console.error("Abbruch: There were failed tests in the initial test run.");',
    "process.exitCode = 2;",
    "",
  ].join("\n");
}

function ersteRueckgabe(context, meldungszeilen) {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST } };
  const dateien = { ...KOPIEN_LISTE, "src/rechnen.js": VERDOPPELT, "package.json": MIT_MUTATION["package.json"], "mutation.mjs": erstlaufRotMit(meldungszeilen) };
  const { lauf, beleg } = starte(context, { auftrag: TESTUMBAU, drehbuch, dateien });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  return beleg.runden[0].split("\n");
}

test("die Rückgabe an die nächste Runde enthält die ganze Fehlermeldung des roten Falls aus dem Grundlauf", (context) => {
  const meldung = Array.from({ length: 12 }, (_, index) => `Meldungszeile ${index + 1}`);
  const rueckgabe = ersteRueckgabe(context, meldung);
  assert.deepEqual(
    rueckgabe.filter((zeile) => zeile.startsWith(BLOCK)),
    meldung.map((zeile) => `${BLOCK}${zeile}`),
    rueckgabe.join("\n"),
  );
});

test("die Rückgabe an die nächste Runde enthält höchstens 100 Zeilen Fehlermeldung", (context) => {
  const meldung = Array.from({ length: GESAMT_ZEILEN * 2 }, (_, index) => `Meldungszeile ${index + 1}`);
  const zeilen = ersteRueckgabe(context, meldung).filter((zeile) => zeile.startsWith(BLOCK));
  assert.equal(zeilen.length, GESAMT_ZEILEN);
  assert.equal(zeilen[0], `${BLOCK}Meldungszeile 1`);
});

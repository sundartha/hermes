import assert from "node:assert/strict";
import { test } from "node:test";

import { UMBAU_AUSWEG } from "../../tools/auftrag/format.mjs";
import { REGEL, schnittBefunde } from "../../tools/auftrag/planung/schnitt.mjs";
import { probeDirectory } from "./probe-repo.js";

const DATEI = "src/rechnen.js";
const ZWILLING = "src/rechnen.ts";
const ANDERER_NAME = "src/zaehlen.ts";
const ANDERE_ENDUNG = "src/rechnen.mts";
const ABNAHME = "test/rechnen/bestand.test.js";
const REGEL_BEREICH = `Regel ${REGEL.bereich}: `;
const VERLANGT_ORDNER = `a1: bereich ist ${DATEI}, die Produktdateien verlangen src/`;

function umbau(erwarteteDateien) {
  return { id: "a1", art: "umbau", ziel: "Gib der Datei Typen", bereich: DATEI, erwarteteDateien, vorbild: DATEI, abnahme: ABNAHME, erwarteterFehler: "keiner", prueft: UMBAU_AUSWEG, abhaengigVon: [], altfunktionen: [] };
}

function bereichBefunde(context, erwarteteDateien) {
  const root = probeDirectory(context, {
    ".github/CODEOWNERS": "/src/geschuetzt.js @owner\n",
    "tools/bereiche.json": JSON.stringify([{ bereich: "rechnen" }]),
    [ABNAHME]: "",
  });
  const schnitt = { annahmen: [], fehlendeSzenarien: [], ownerAufgaben: [], gemeinsameNamen: [], auftraege: [umbau(erwarteteDateien)] };
  const eingaben = { soll: new Map(), berichte: [], funktionsliste: [], dateikarte: [{ datei: DATEI, tests: [ABNAHME] }], dokumente: {}, root, nurUmbau: true };
  const { befunde } = schnittBefunde(schnitt, eingaben);
  return befunde.filter((befund) => befund.startsWith(REGEL_BEREICH)).map((befund) => befund.slice(REGEL_BEREICH.length));
}

test("zwilling-bereich: nennt ein Umbau die js-Datei und ihren ts-Zwilling, ist die js-Datei der bereich", (context) => {
  assert.deepEqual(bereichBefunde(context, [DATEI, ZWILLING]), []);
});

test("zwilling-bereich: nennt ein Umbau nur den ts-Zwilling, ist die js-Datei der bereich", (context) => {
  assert.deepEqual(bereichBefunde(context, [ZWILLING]), []);
});

test("zwilling-bereich: eine ts-Datei mit anderem Namen verlangt weiter den gemeinsamen Ordner", (context) => {
  assert.deepEqual(bereichBefunde(context, [DATEI, ANDERER_NAME]), [VERLANGT_ORDNER]);
});

test("zwilling-bereich: eine mts-Datei gleichen Namens verlangt weiter den gemeinsamen Ordner", (context) => {
  assert.deepEqual(bereichBefunde(context, [DATEI, ANDERE_ENDUNG]), [VERLANGT_ORDNER]);
});

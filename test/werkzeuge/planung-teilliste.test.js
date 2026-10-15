import assert from "node:assert/strict";
import { test } from "node:test";

import { setzeTeillisteEin } from "../../tools/auftrag/planung/teilliste.mjs";

function auftrag(id, prueft, zusatz = {}) {
  return { id, art: "funktion", bereich: "src/routes/", prueft, ...zusatz };
}

const SCHNITT = {
  annahmen: ["Annahme alt"],
  fehlendeSzenarien: [],
  ownerAufgaben: ["Owner prüft die Frist"],
  gemeinsameNamen: [{ name: "bestaetigt", anbieter: "src/routes/", nutzer: "src/anrufe/" }],
  auftraege: [auftrag("a1", ["S1"]), auftrag("a2", ["S2"]), auftrag("a3", ["S3"]), auftrag("a4", ["S4"])],
};

function pruefeBefundeOhneAenderung(faelle, schnitt = SCHNITT) {
  for (const [teilliste, befund] of faelle) {
    const ergebnis = setzeTeillisteEin(schnitt, teilliste);
    assert.deepEqual(ergebnis.befunde, [befund], JSON.stringify(teilliste));
    assert.equal(ergebnis.schnitt, schnitt);
  }
}

function kennungen({ schnitt }) {
  return schnitt.auftraege.map(({ id }) => id);
}

test("teilliste: eine Änderung ersetzt, ergänzt und entfernt Aufträge und lässt den Rest gleich", () => {
  const geaendert = auftrag("a2", ["S2", "S5"], { ziel: "Ziel a2 neu" });
  const ergebnis = setzeTeillisteEin(SCHNITT, { auftraege: [auftrag("a14", ["S6"]), geaendert, auftrag("a15", ["S7"])], entfernt: ["a3"], annahmen: ["Annahme neu"] });
  assert.deepEqual(ergebnis.befunde, []);
  assert.deepEqual(kennungen(ergebnis), ["a1", "a2", "a4", "a14", "a15"]);
  assert.deepEqual(ergebnis.schnitt.auftraege[1], geaendert);
  assert.deepEqual(ergebnis.schnitt.auftraege[0], SCHNITT.auftraege[0]);
  assert.deepEqual(ergebnis.schnitt.annahmen, ["Annahme neu"]);
  for (const feld of ["fehlendeSzenarien", "ownerAufgaben", "gemeinsameNamen"]) assert.deepEqual(ergebnis.schnitt[feld], SCHNITT[feld]);
});

test("teilliste: reihenfolge ordnet die neue Liste um, die alte Liste bleibt unverändert", () => {
  const ergebnis = setzeTeillisteEin(SCHNITT, { auftraege: [auftrag("a14", ["S6"])], reihenfolge: ["a14", "a4", "a3", "a2", "a1"] });
  assert.deepEqual(ergebnis.befunde, []);
  assert.deepEqual(kennungen(ergebnis), ["a14", "a4", "a3", "a2", "a1"]);
  assert.deepEqual(SCHNITT.auftraege.map(({ id }) => id), ["a1", "a2", "a3", "a4"]);
});

test("teilliste: unbekannte, doppelte und zugleich entfernte Kennungen sind Befunde und ändern nichts", () => {
  const faelle = [
    [[], "Regel Teilliste: teilliste ist kein Objekt"],
    [{ auftraege: [{ art: "funktion" }] }, "Regel Teilliste: Auftrag 1 unter auftraege hat keine id"],
    [{ auftraege: [auftrag("a2", ["S2"]), auftrag("a2", ["S5"])] }, "Regel Teilliste: a2 steht mehrfach unter auftraege"],
    [{ auftraege: [auftrag("a2", ["S2"])], entfernt: ["a2"] }, "Regel Teilliste: a2 steht unter auftraege und unter entfernt"],
    [{ auftraege: [], entfernt: ["a9"] }, "Regel Teilliste: entfernt nennt a9, das es in der Schnittliste nicht gibt"],
    [{ auftraege: [auftrag("a14", ["S6"])], reihenfolge: ["a1", "a2", "a3", "a4"] }, "Regel Teilliste: reihenfolge muss genau die Kennungen der neuen Liste nennen: a1, a14, a2, a3, a4"],
  ];
  pruefeBefundeOhneAenderung(faelle);
});

test("teilliste: auftraege, entfernt oder reihenfolge ohne Liste sind Befunde und ändern nichts", () => {
  const faelle = [
    [{ entfernt: "a3" }, "Regel Teilliste: entfernt ist keine Liste"],
    [{ auftraege: auftrag("a2", ["S2", "S5"]) }, "Regel Teilliste: auftraege ist keine Liste"],
    [{ auftraege: [auftrag("a14", ["S6"])], reihenfolge: "a14" }, "Regel Teilliste: reihenfolge ist keine Liste"],
  ];
  pruefeBefundeOhneAenderung(faelle);
});

test("teilliste: eine doppelte Kennung der alten Liste, die die Teilliste berührt, ist ein Befund und ändert nichts", () => {
  const doppelt = { ...SCHNITT, auftraege: [...SCHNITT.auftraege, auftrag("a2", ["S9"])] };
  const befund = "Regel Teilliste: a2 steht mehrfach in der Schnittliste";
  pruefeBefundeOhneAenderung([
    [{ auftraege: [auftrag("a2", ["S2", "S5"])] }, befund],
    [{ entfernt: ["a2"] }, befund],
    [{ auftraege: [auftrag("a14", ["S6"])], reihenfolge: ["a14", "a1", "a2", "a3", "a4", "a2"] }, befund],
  ], doppelt);
  const unberuehrt = setzeTeillisteEin(doppelt, { auftraege: [auftrag("a1", ["S1", "S8"])] });
  assert.deepEqual(unberuehrt.befunde, []);
  assert.deepEqual(kennungen(unberuehrt), ["a1", "a2", "a3", "a4", "a2"]);
});

test("teilliste: ein Auftrag der alten Schnittliste ohne id ist ein Befund und ändert nichts", () => {
  for (const kaputt of [null, "a9", { art: "funktion" }]) {
    const alte = { ...SCHNITT, auftraege: [SCHNITT.auftraege[0], kaputt, ...SCHNITT.auftraege.slice(1)] };
    const befund = "Regel Teilliste: Auftrag 2 der Schnittliste hat keine id; schick die ganze Schnittliste unter schnitt";
    pruefeBefundeOhneAenderung([
      [{ auftraege: [auftrag("a2", ["S2", "S5"])] }, befund],
      [{ entfernt: ["a3"] }, befund],
      [{ auftraege: [auftrag("a14", ["S6"])], reihenfolge: ["a14", "a1", "a2", "a3", "a4"] }, befund],
    ], alte);
  }
});

test("teilliste: ein unbekannter Schlüssel ist ein Befund mit seinem Namen und ändert nichts", () => {
  const erlaubt = "erlaubt sind auftraege, entfernt, reihenfolge, annahmen, fehlendeSzenarien, ownerAufgaben, gemeinsameNamen";
  pruefeBefundeOhneAenderung([
    [{ entfernen: ["a3"] }, `Regel Teilliste: unbekannter Schlüssel entfernen; ${erlaubt}`],
    [{ auftraege: [auftrag("a2", ["S2", "S5"])], annahme: ["Annahme neu"] }, `Regel Teilliste: unbekannter Schlüssel annahme; ${erlaubt}`],
    [{ schnitt: SCHNITT }, `Regel Teilliste: unbekannter Schlüssel schnitt; ${erlaubt}`],
  ]);
  const zwei = setzeTeillisteEin(SCHNITT, { reihenfolgen: ["a1"], entfernen: ["a3"] });
  assert.deepEqual(zwei.befunde, [`Regel Teilliste: unbekannter Schlüssel reihenfolgen; ${erlaubt}`, `Regel Teilliste: unbekannter Schlüssel entfernen; ${erlaubt}`]);
  assert.equal(zwei.schnitt, SCHNITT);
  const mitForm = setzeTeillisteEin(SCHNITT, { zusatz: [], auftraege: "a1" });
  assert.deepEqual(mitForm.befunde, [`Regel Teilliste: unbekannter Schlüssel zusatz; ${erlaubt}`, "Regel Teilliste: auftraege ist keine Liste"]);
  assert.equal(mitForm.schnitt, SCHNITT);
});

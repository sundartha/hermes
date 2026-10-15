import assert from "node:assert/strict";
import { test } from "node:test";

import { ANGABEN } from "../../tools/auftrag/planung/erkundung.mjs";
import { verdichteBerichte } from "../../tools/auftrag/planung/verdichtung.mjs";

const ROUTE = "src/beispiel/route.js";
const SPEICHER = "src/beispiel/speicher.js";

const VOLL = {
  weg: [
    { rolle: "eingang", datei: ROUTE, funktion: "hinterlege", von: 2, bis: 4 },
    { rolle: "logik", ausweg: "nicht gefunden, weil die Route selbst prüft" },
    { rolle: "logik", datei: "src/beispiel/sitzung.js", funktion: "pruefeSitzung", ausweg: "nicht gefunden, weil die Sitzung schon vor dem Handler geprüft wird" },
    { rolle: "speicher", datei: SPEICHER, funktion: "setzeNummer", von: 31, bis: 47, notiz: "schreibt den Status" },
    { rolle: "wirkung", datei: SPEICHER, funktion: "meldeStatus", von: 50, bis: 58 },
  ],
  aenderungen: [
    { datei: SPEICHER, funktion: "setzeNummer", von: 31, bis: 47, neueZeilen: 6 },
    { datei: "src/beispiel/bestaetigung.js", neu: "datei", neueZeilen: 40 },
    { datei: SPEICHER, funktion: "pruefeCode", neu: "funktion", neueZeilen: 12 },
  ],
  tests: ["test/beispiel/route.test.js", "test/beispiel/speicher.test.js"],
  vorbild: "src/beispiel/vorbild.js",
  schema: { aenderung: true, fundstelle: "src/beispiel/schema.js:12" },
  codeowners: [SPEICHER],
  ownerEntscheidung: { text: "Der Owner legt die Frist fest", fundstelle: "pitch.md, ## Problem" },
  eingangImTest: "erreichbar",
  widersprueche: [{ designDoc: "design.md, ## Lösung", code: `${ROUTE}:3`, text: "Das Design Doc nennt PUT, der Code POST" }],
};

const AUSWEGE = {
  weg: [{ rolle: "eingang", datei: ROUTE, funktion: "bestaetige", von: 5, bis: 7 }, { rolle: "wirkung", ausweg: "nicht gefunden, weil die Wirkung erst entsteht" }],
  aenderungen: "keine Änderung, weil T2 nur einen Test verlangt",
  tests: "nicht gefunden, weil es zu dieser Route keinen Test gibt",
  vorbild: "nicht gefunden, weil keine Datei den Stil vorgibt",
  schema: { aenderung: false, fundstelle: "design.md, ## Daten" },
  codeowners: [],
  ownerEntscheidung: "keine, weil keine geschützte Datei betroffen ist",
  eingangImTest: "nicht erreichbar, weil der Eingang einen echten Anruf braucht",
  widersprueche: [],
};

const BERICHTE = [
  { gruppe: ["S1", "T2"], nummern: { S1: VOLL, T2: AUSWEGE }, hinweise: ["Die Route prüft die Sitzung schon vor dem Handler.", "Ein zweiter Hinweis zu Zeile 17."] },
  { gruppe: ["S4"], nummern: { S4: { ...VOLL, widersprueche: [] } }, hinweise: [] },
];

function werte(wert) {
  if (Array.isArray(wert)) return wert.flatMap(werte);
  if (wert !== null && typeof wert === "object") return Object.values(wert).flatMap(werte);
  return [String(wert)];
}

function gepruefteWerte(berichte) {
  return berichte.flatMap((bericht) => [...Object.values(bericht.nummern).flatMap((angaben) => ANGABEN.flatMap((feld) => werte(angaben[feld]))), ...bericht.hinweise]);
}

function fehlende(berichte, text) {
  return gepruefteWerte(berichte).filter((wert) => !text.includes(wert));
}

test("verdichtung: die verdichtete Fassung enthält jeden Wert jeder geprüften Angabe", () => {
  const text = verdichteBerichte(BERICHTE);
  assert.deepEqual(fehlende(BERICHTE, text), []);
  for (const nummer of ["S1", "T2", "S4"]) assert.ok(text.includes(`#### ${nummer}\n`), text);
  for (const ausweg of [AUSWEGE.aenderungen, AUSWEGE.tests]) assert.ok(text.includes(ausweg), text);
  assert.ok(text.includes("hinweis: Die Route prüft die Sitzung schon vor dem Handler."), text);
});

test("verdichtung: eine Verdichtung ohne einen Wert macht den Vergleich rot", () => {
  const text = verdichteBerichte(BERICHTE);
  for (const wert of gepruefteWerte(BERICHTE)) assert.ok(fehlende(BERICHTE, text.replaceAll(wert, "")).includes(wert), wert);
});

test("verdichtung: die Tabelle ist kürzer als der Bericht als JSON", () => {
  assert.ok(verdichteBerichte(BERICHTE).length < JSON.stringify(BERICHTE, null, 2).length);
});

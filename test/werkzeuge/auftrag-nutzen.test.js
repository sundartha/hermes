import assert from "node:assert/strict";
import { test } from "node:test";

import { bauPrompt } from "../../tools/auftrag/agenten.mjs";
import { NUTZEN } from "../../tools/auftrag/planung/erkundung.mjs";
import { auftragAusSchnitt } from "../../tools/auftrag/planung/zusammensetzen.mjs";
import { probeDirectory } from "./probe-repo.js";

const KOSTEN = ["const VORSPANN = 1;", "", "export function summeMikroCent(betraege) {", "  return betraege.reduce((gesamt, betrag) => gesamt + betrag, VORSPANN);", "}", ""].join("\n");
const SUMME = { datei: "src/kosten.js", funktion: "summeMikroCent" };
const SOLL = new Map([
  ["S1", { text: "Wenn S1" }],
  ["S2", { text: "Wenn S2" }],
]);

function neueStelle(funktion, nutzen) {
  return { datei: "src/bericht.js", funktion, neu: "funktion", neueZeilen: 5, vorhanden: { suche: ["Mikro"], treffer: ["src/kosten.js:3"], urteil: NUTZEN, nutzen } };
}

const BERICHTE = [
  { gruppe: ["S1"], nummern: { S1: { aenderungen: [neueStelle("gesamt", SUMME), neueStelle("zweite", SUMME)] } } },
  { gruppe: ["S2"], nummern: { S2: { aenderungen: [{ ...neueStelle("andere", SUMME), datei: "src/anderswo.js" }, { ...neueStelle("dritte", SUMME), datei: "src/ohne.js", vorhanden: { urteil: "kein Treffer passt, weil nichts passt" } }] } } },
];

function eintrag(prueft, erwarteteDateien = ["src/bericht.js"]) {
  return { id: "a1", art: "funktion", ziel: "Zeige die Summe", bereich: "src/bericht.js", erwarteteDateien, abnahme: "test/bericht.test.js", erwarteterFehler: "Summe", prueft };
}

test("der Auftrag, der die Datei der neuen Stelle ändert, bekommt jede Funktion mit Urteil nutzen genau einmal", () => {
  const auftrag = auftragAusSchnitt(eintrag(["S1"]), SOLL, BERICHTE);
  assert.deepEqual(auftrag.nutzen, [{ ...SUMME, fuer: "gesamt" }]);
});

test("auch ein Umbau ohne Nummern bekommt nutzen, wenn er die Datei der neuen Stelle ändert", () => {
  const umbau = { ...eintrag("keiner, weil Umbau", ["src/anderswo.js"]), art: "umbau" };
  assert.deepEqual(auftragAusSchnitt(umbau, SOLL, BERICHTE).nutzen, [{ ...SUMME, fuer: "andere" }]);
});

test("ein Auftrag, der keine Datei einer neuen Stelle mit Urteil nutzen ändert, bekommt kein Feld nutzen", () => {
  assert.equal(Object.hasOwn(auftragAusSchnitt(eintrag(["S1"], ["src/ohne.js"]), SOLL, BERICHTE), "nutzen"), false);
});

test("fehlen die Erkundungsberichte, bricht das Zusammensetzen ab, statt nutzen still wegzulassen", () => {
  assert.throws(() => auftragAusSchnitt(eintrag(["S1"]), SOLL), /Erkundungsberichte/);
});

function prompt(context, nutzen) {
  const root = probeDirectory(context, { "src/kosten.js": KOSTEN });
  const auftrag = { ...auftragAusSchnitt(eintrag(["S1"]), SOLL, []), ...(nutzen ? { nutzen } : {}) };
  return bauPrompt({ phase: { entwurf: { "src/bericht.js": "Entwurf." } }, auftrag, root }, "Ausgabe.");
}

test("der Bau-Agent sieht den Code jeder Funktion, die er nutzen soll, auch außerhalb seines Bereichs", (context) => {
  const text = prompt(context, [{ ...SUMME, fuer: "gesamt" }]);
  assert.match(text, /## Vorhandene Logik, die du nutzt/);
  assert.ok(text.includes("src/kosten.js: summeMikroCent (für gesamt)"), text);
  assert.ok(text.includes("export function summeMikroCent(betraege) {\n  return betraege.reduce"), text);
  assert.ok(!text.includes("const VORSPANN"), text);
  assert.ok(text.includes("Auftrag passt nicht: Regel liegt in <Datei>:<Funktion>"), text);
});

test("ist die Funktion nicht mehr da, verlangt der Prompt den Ausstieg statt eines Nachbaus", (context) => {
  const text = prompt(context, [{ datei: "src/kosten.js", funktion: "weg", fuer: "gesamt" }, { datei: "src/fehlt.js", funktion: "auch", fuer: "gesamt" }]);
  assert.ok(text.includes("src/kosten.js: weg gibt es dort nicht mehr; dann antwortest du als Letztes mit genau einer Zeile: „Auftrag passt nicht: nutzen veraltet: src/kosten.js:weg“."), text);
  assert.ok(text.includes("src/fehlt.js: auch gibt es dort nicht mehr"), text);
});

test("ohne nutzen hat der Prompt keinen Abschnitt zur vorhandenen Logik", (context) => {
  assert.ok(!prompt(context).includes("Vorhandene Logik"));
});

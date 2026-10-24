import assert from "node:assert/strict";
import { test } from "node:test";

import { mitNieSaetzenDerVorgaben } from "../../tools/auftrag/planung/nie-vorbelegung.mjs";
import { abgelegt, plane } from "./planung-plane-probe.js";
import { LAUF_FRIST_MS, ROUTE, alsJson, auftrag, schnittliste } from "./planung-probe.js";

const ALLE_NUMMERN = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "B1", "T1", "T2"];
const FALLE = "Heute freigeschaltete Konten würden mit dem Wegfall der Liste sofort den Hinweis für Fremde hören: Wie der Übergang läuft, entscheidet das Design Doc.";
const ANRUF_STATT_SMS = "Nicht Teil dieser Änderung: Bestätigung über einen Anruf statt einer SMS, weil Hermes SMS schon über Telnyx verschickt und ein Anruf pro Bestätigung mehr kostet.";
const ZWEITE_NUMMER = "Nicht Teil dieser Änderung: eine zweite eigene Nummer pro Kunde, weil heute jeder Kunde genau eine eigene Nummer hinterlegt.";

function nieSatz(satz, abschnitt) {
  return { satz, quelle: "pitch.md", abschnitt };
}

function nieSaetzeImSchnitt(lauf) {
  return abgelegt(lauf, "schnitt.json").auftraege.map(({ id, wasDarfNiePassieren }) => [id, wasDarfNiePassieren]);
}

test("plane: schneidet der Planer genau einen Auftrag, stehen bei ihm alle Sätze aus Fallen und Nicht-Zielen des Pitches wörtlich unter wasDarfNiePassieren, ohne die, die er schon nennt, doppelt", { timeout: LAUF_FRIST_MS }, (context) => {
  const einziger = auftrag("a1", ROUTE, { prueft: ALLE_NUMMERN, abnahme: "test/nummern/eigene-nummer-hinterlegen.test.js", abhaengigVon: [], wasDarfNiePassieren: [nieSatz(ZWEITE_NUMMER, "## Nicht-Ziele")] });
  const lauf = plane(context, { "planer|## Zuschnitt": [alsJson({ schnitt: schnittliste({ auftraege: [einziger], gemeinsameNamen: [] }) })] });

  assert.deepEqual(nieSaetzeImSchnitt(lauf), [["a1", [nieSatz(ZWEITE_NUMMER, "## Nicht-Ziele"), nieSatz(FALLE, "## Fallen"), nieSatz(ANRUF_STATT_SMS, "## Nicht-Ziele")]]]);
});

test("plane: schneidet der Planer mehrere Aufträge, belegt plane keine Nie-Sätze vor", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context);

  assert.deepEqual(nieSaetzeImSchnitt(lauf), [["a0", undefined], ["a1", []], ["a2", []], ["a3", []]]);
});

const PITCH_MIT_SZENARIO_SATZ = ["# Pitch", "", "## Fallen", "Keine weiteren.", "", "### Übergang", "- Der Status bleibt bei einem SMS-Fehler offen.", "- Die Liste bleibt bis zum Umzug bestehen.", "", "## Nicht-Ziele", "- Nicht Teil dieser Änderung: ein zweiter Kanal."].join("\n");
const SOLL_MIT_SATZ = new Map([["S1", { text: "Schlägt die SMS fehl, gilt: Der Status bleibt bei einem SMS-Fehler offen." }]]);

function vorbelegt(auftraege) {
  return mitNieSaetzenDerVorgaben({ auftraege }, PITCH_MIT_SZENARIO_SATZ, SOLL_MIT_SATZ).auftraege;
}

test("Nie-Sätze vorbelegen: ein Listenpunkt, der wörtlich in einem Szenario steht, und Text außerhalb von Listenpunkten kommen nicht dazu", () => {
  assert.deepEqual(vorbelegt([{ id: "a1", art: "funktion", wasDarfNiePassieren: [] }]), [
    { id: "a1", art: "funktion", wasDarfNiePassieren: [nieSatz("Die Liste bleibt bis zum Umzug bestehen.", "## Fallen"), nieSatz("Nicht Teil dieser Änderung: ein zweiter Kanal.", "## Nicht-Ziele")] },
  ]);
});

test("Nie-Sätze vorbelegen: ein einziger Auftrag ohne roten Test bleibt unverändert", () => {
  assert.deepEqual(vorbelegt([{ id: "a1", art: "umbau", wasDarfNiePassieren: [] }]), [{ id: "a1", art: "umbau", wasDarfNiePassieren: [] }]);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { ausserhalbGleich, festeStuecke, hatMarker } from "../../tools/src-nur-lauf/konfliktstellen.mjs";

const KONFLIKT = ["<<<<<<< HEAD", "master", "=======", "paket", ">>>>>>> Paket"];
const EINE_STELLE = ["p1", "p2", ...KONFLIKT, "q1", "q2", ""].join("\n");
const ZWEI_STELLEN = ["p", ...KONFLIKT, "mitte1", "mitte2", ...KONFLIKT, "q", ""].join("\n");
const DREI_STELLEN = ["p", ...KONFLIKT, "a", ...KONFLIKT, "a", ...KONFLIKT, "q", ""].join("\n");
const WIEDERHOLUNG = ["x", "x", ...KONFLIKT, "x", "x", ""].join("\n");

const FAELLE = [
  ["Datei ohne Konfliktmarken: jede Fassung ist erlaubt", "a\nb\n", "ganz anders\n", true],
  ["eine Stelle, Lösung zwischen den festen Teilen", EINE_STELLE, "p1\np2\ngelöst\nq1\nq2\n", true],
  ["eine Stelle, leere Lösung", EINE_STELLE, "p1\np2\nq1\nq2\n", true],
  ["eine Stelle, Lösung über mehrere Zeilen", EINE_STELLE, "p1\np2\nein\nzwei\ndrei\nq1\nq2\n", true],
  ["eine Stelle, Zeile vor dem Konflikt verändert", EINE_STELLE, "p1\nXX\ngelöst\nq1\nq2\n", false],
  ["eine Stelle, erste Zeile vor dem Konflikt verändert", EINE_STELLE, "XX\np2\ngelöst\nq1\nq2\n", false],
  ["eine Stelle, Zeile nach dem Konflikt verändert", EINE_STELLE, "p1\np2\ngelöst\nq1\nXX\n", false],
  ["eine Stelle, Zeile hinter dem Konflikt angehängt", EINE_STELLE, "p1\np2\ngelöst\nq1\nq2\nneu\n", false],
  ["zwei Stellen, beide gelöst, Mitte unverändert", ZWEI_STELLEN, "p\nA\nmitte1\nmitte2\nB\nq\n", true],
  ["zwei Stellen, Zeile in der Mitte eingefügt", ZWEI_STELLEN, "p\nA\nmitte1\nneu\nmitte2\nB\nq\n", false],
  ["zwei Stellen, Mitte vertauscht", ZWEI_STELLEN, "p\nA\nmitte2\nmitte1\nB\nq\n", false],
  ["zwei Stellen, Mitte fehlt", ZWEI_STELLEN, "p\nA\nB\nq\n", false],
  ["drei Stellen, jedes mittlere Stück einmal vorhanden", DREI_STELLEN, "p\nA\na\nB\na\nC\nq\n", true],
  ["drei Stellen, ein mittleres Stück nur einmal vorhanden", DREI_STELLEN, "p\nA\na\nB\nC\nq\n", false],
  ["feste Teile überlappen, weil eine Zeile außerhalb fehlt", WIEDERHOLUNG, "x\nx\nx\n", false],
  ["feste Teile überlappen nicht, Lösung dazwischen", WIEDERHOLUNG, "x\nx\ngelöst\nx\nx\n", true],
];

function ergebnisse(erwartet) {
  return FAELLE.filter((fall) => fall[3] === erwartet).map(([name, automatisch, aufgeloest]) => [name, ausserhalbGleich(festeStuecke(automatisch), aufgeloest)]);
}

test("Konfliktstellen: jede Lösung an der Konfliktstelle und jede Fassung ohne Marken ist erlaubt", () => {
  for (const [name, ergebnis] of ergebnisse(true)) assert.equal(ergebnis, true, name);
});

test("Konfliktstellen: jede Abweichung außerhalb der Konfliktstellen ist nicht erlaubt", () => {
  for (const [name, ergebnis] of ergebnisse(false)) assert.equal(ergebnis, false, name);
});

const MARKER_FAELLE = [
  ["keine Datei", null, false],
  ["Datei ohne Marker", "a\nb\n", false],
  ["Anfangsmarker am Zeilenanfang", "a\n<<<<<<< x\nb\n", true],
  ["Endmarker am Zeilenanfang", "a\n>>>>>>> x\n", true],
  ["Marker mitten in der Zeile", "a <<<<<<< x\n", false],
  ["Trennzeile allein", "a\n=======\nb\n", false],
];

test("Konfliktstellen: Zeilen wie Konfliktmarker in einer Fassung werden erkannt", () => {
  for (const [name, text, erwartet] of MARKER_FAELLE) assert.equal(hatMarker(text), erwartet, name);
});

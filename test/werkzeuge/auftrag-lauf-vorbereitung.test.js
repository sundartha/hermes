import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ROTER_TEST, funktion, pruefung } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";

const VORBEREITUNG = "vorbereitung";
const DATEI = "src/call-confirmation.js";
const WOZU = "Wozu: Ein Umbau an einer JavaScript-Datei des Anrufbereichs";
const ABSATZ = `Zweck ${VORBEREITUNG}: Drehbuchtext des Ersatz-Agenten.`;
const VORHER = { [DATEI]: "export const f = (a, d) => a || d;\nexport const t = (a, b) => `n=${a - b}`;\n" };
const UMBAU_IM_BEREICH = { ...UMBAU, erwarteteDateien: [DATEI], vorbild: DATEI };

function umbau(context, nachher) {
  return starte(context, { auftrag: UMBAU_IM_BEREICH, drehbuch: { bau: { [DATEI]: nachher }, "bau-antwort": ABSATZ }, dateien: VORHER });
}

function namen(beleg) {
  return beleg.pruefungen.map(({ name }) => name);
}

test("ein Umbau mit einer Katalog-Umformung an einer Datei der Liste kommt direkt nach feste-pfade an der Prüfung vorbei", (context) => {
  const { lauf, beleg } = umbau(context, "export const f = (a, d) => a || d;\nexport const t = (a, b) => `n=${String(a - b)}`;\n");
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const liste = namen(beleg);
  assert.equal(liste[liste.indexOf("feste-pfade") + 1], VORBEREITUNG, liste.join(", "));
  assert.equal(pruefung(beleg, VORBEREITUNG), 0, JSON.stringify(beleg.pruefungen));
});

test("schreibt der Bau-Agent bei einem Umbau || zu ?? um, wird die Runde rot, und die zweite Runde bekommt Befund und Zweck-Text", (context) => {
  const { werkzeug, lauf, beleg } = umbau(context, "export const f = (a, d) => a ?? d;\nexport const t = (a, b) => `n=${a - b}`;\n");
  const ergebnis = { status: lauf.status, ergebnis: beleg.ergebnis, grund: beleg.grund, exitCode: pruefung(beleg, VORBEREITUNG) };
  assert.deepEqual(ergebnis, { status: EXIT_ROT, ergebnis: "rot", grund: `${VORBEREITUNG} endete mit Exit ${EXIT_ROT}.`, exitCode: EXIT_ROT }, lauf.stdout + lauf.stderr);
  const zweiteRunde = readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8");
  const befund = `${DATEI}:1: Änderung, die keine Umformung aus tools/vorbereitung/katalog.json ist`;
  for (const teil of [befund, WOZU, `dem Bau-Agenten: ${VORBEREITUNG}`]) assert.ok(zweiteRunde.includes(teil), `${teil}\n${zweiteRunde}`);
});

test("ein Funktionsauftrag ruft die Prüfung nicht auf, auch wenn er eine Datei der Liste ändert", (context) => {
  const auftrag = { ...funktion("2 !== 4"), bereich: "src/", erwarteteDateien: ["src/rechnen.js", "test/rechnen.test.js", DATEI] };
  const bau = { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n", [DATEI]: "export const f = (a, d) => a ?? d;\n" };
  const { lauf, beleg } = starte(context, { auftrag, drehbuch: { test: { "test/rechnen.test.js": ROTER_TEST }, bau }, dateien: VORHER });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const liste = namen(beleg);
  assert.ok(liste.includes("feste-pfade"), liste.join(", "));
  assert.ok(!liste.includes(VORBEREITUNG), liste.join(", "));
});

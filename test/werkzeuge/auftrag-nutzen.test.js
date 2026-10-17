import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { bauPrompt } from "../../tools/auftrag/agenten.mjs";
import { GRUEN } from "../../tools/auftrag/bericht.mjs";
import { nutzungsVerstoesse } from "../../tools/auftrag/befehle.mjs";
import { NUTZEN } from "../../tools/auftrag/planung/erkundung.mjs";
import { auftragAusSchnitt } from "../../tools/auftrag/planung/zusammensetzen.mjs";
import { PRUEFUNG } from "../../tools/auftrag/zweck.mjs";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";

const KOSTEN = ["const VORSPANN = 1;", "", "export function summeMikroCent(betraege) {", "  return betraege.reduce((gesamt, betrag) => gesamt + betrag, VORSPANN);", "}", ""].join("\n");
const SUMME = { datei: "src/kosten.js", funktion: "summeMikroCent" };
const ZEILE_DER_SUMME = "src/kosten.js:3";
const GESCHAETZTE_NEUE_ZEILEN = 5;
const SOLL = new Map([
  ["S1", { text: "Wenn S1" }],
  ["S2", { text: "Wenn S2" }],
]);

function neueStelle(funktion, nutzen) {
  return { datei: "src/bericht.js", funktion, neu: "funktion", neueZeilen: GESCHAETZTE_NEUE_ZEILEN, vorhanden: { suche: ["Mikro"], treffer: [ZEILE_DER_SUMME], urteil: NUTZEN, nutzen } };
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

const ZWECK = JSON.parse(readFileSync(join(REPO_ROOT, "tools/auftrag/zweck.json"), "utf8"));
const VERDOPPLE = { datei: "src/rechnen.js", funktion: "verdopple", fuer: "gross" };
const MIT_NUTZEN = { ...UMBAU, nutzen: [VERDOPPLE] };
const NACHGEBAUT = { "src/text.js": "export function gross(text) {\n  return text.toUpperCase();\n}\n\nexport function doppelt(zahl) {\n  return zahl;\n}\n" };
const GENUTZT = { "src/text.js": 'import { verdopple } from "./rechnen.js";\n\nexport function gross(text) {\n  return text.toUpperCase();\n}\n\nexport const doppelt = verdopple;\n' };

const NICHT_GENUTZT = "nicht genutzt: src/rechnen.js:verdopple (für gross)";

function neueZeile(text, datei = "src/text.js") {
  return { datei, text };
}

test("nur ein Aufruf oder Import mit ganzem Namen zählt als genutzt, keine Deklaration und kein längerer Name", () => {
  assert.deepEqual(nutzungsVerstoesse([VERDOPPLE], [neueZeile("const x = verdopple(2);")]), []);
  assert.deepEqual(nutzungsVerstoesse([VERDOPPLE], [neueZeile('import { verdopple } from "./rechnen.js";')]), []);
  assert.deepEqual(nutzungsVerstoesse([VERDOPPLE], [neueZeile("const x = verdoppleAlles(2);")]), [NICHT_GENUTZT]);
  assert.deepEqual(nutzungsVerstoesse([VERDOPPLE], []), [NICHT_GENUTZT]);
});

test("nennt der Bau den Namen nur im Kommentar oder in einem Text und baut die Regel unter anderem Namen nach, ist die Funktion nicht genutzt", () => {
  const nachbau = [neueZeile("export function doppelt(zahl) {"), neueZeile("  return zahl * 2;"), neueZeile("}")];
  assert.deepEqual(nutzungsVerstoesse([VERDOPPLE], [neueZeile("// verdopple passt hier nicht"), ...nachbau]), [NICHT_GENUTZT]);
  assert.deepEqual(nutzungsVerstoesse([VERDOPPLE], [neueZeile('const grund = "verdopple passt hier nicht";'), ...nachbau]), [NICHT_GENUTZT]);
  assert.deepEqual(nutzungsVerstoesse([VERDOPPLE], [neueZeile("const text = `doppelt: ${verdopple(2)}`;")]), []);
});

test("deklariert der Bau dieselbe Funktion in einer anderen Datei neu, ist das ein Nachbau, auch wenn er sie danach aufruft", () => {
  const kopie = [neueZeile("function verdopple(zahl) {"), neueZeile("  return zahl * 2;"), neueZeile("export const doppelt = verdopple(1);")];
  assert.deepEqual(nutzungsVerstoesse([VERDOPPLE], kopie), ["nachgebaut: src/text.js deklariert verdopple neu, statt src/rechnen.js:verdopple zu nutzen (für gross)"]);
  assert.deepEqual(nutzungsVerstoesse([VERDOPPLE], [neueZeile("const verdopple = (zahl) => zahl * 2;")]).length, 1);
  assert.deepEqual(nutzungsVerstoesse([VERDOPPLE], [neueZeile("export function verdopple(zahl) {", "src/rechnen.js"), neueZeile("verdopple(1);")]), []);
});

test("baut der Bau-Agent die Regel nach, statt die vorhandene Funktion zu nutzen, ist die Runde rot und Runde 2 nennt Zweck und Ausweg", (context) => {
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: MIT_NUTZEN, drehbuch: { bau: NACHGEBAUT } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(beleg.runden[0], new RegExp(`^Runde 1: ${PRUEFUNG.GENUTZT} endete mit Exit 1\\.`));
  const prompt = readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8");
  const teile = ["## Vorhandene Logik, die du nutzt", "Verstoß: nicht genutzt: src/rechnen.js:verdopple (für gross)", `\nWozu: ${ZWECK[PRUEFUNG.GENUTZT].wozu}\n`, `\nAusweg: ${ZWECK[PRUEFUNG.GENUTZT].ausweg}\n`];
  assert.deepEqual(teile.filter((teil) => !prompt.includes(teil)), []);
});

test("nutzt der Bau-Agent die vorhandene Funktion, ist die Prüfung grün und die Runde geht weiter", (context) => {
  const { lauf, beleg } = starte(context, { auftrag: MIT_NUTZEN, drehbuch: { bau: GENUTZT } });
  const pruefung = beleg?.pruefungen.find(({ name }) => name === PRUEFUNG.GENUTZT);
  assert.equal(pruefung?.exitCode, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(pruefung.zeilen, ["grün: 1 von 1 vorhandenen Funktionen in den neuen Zeilen genutzt."]);
  assert.equal(beleg.ergebnis, GRUEN);
});

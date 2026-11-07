import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { NUR_INFRASTRUKTUR_ZEILE } from "../../tools/mutationspruefung/lauf-einordnung.mjs";
import { exitCodes, MIT_MUTATION, pruefung, UMGEBAUT } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";

const ALTER_STAND = "mutation alter Stand";

function umbauMit(context, mutation) {
  return starte(context, { auftrag: UMBAU, drehbuch: { bau: UMGEBAUT }, dateien: { ...MIT_MUTATION, "mutation.mjs": mutation } });
}

test("bricht die Mutationsprüfung mit rotem Erstlauf ab, nennt der Grund der Runde Testdatei und Testname", (context) => {
  const erstlaufRot = [
    'console.error("Abbruch: Erstlauf rot: test/text.test.js › gross > leer");',
    'console.error("Abbruch: There were failed tests in the initial test run.");',
    "process.exitCode = 2;",
    "",
  ].join("\n");
  const { lauf, beleg } = umbauMit(context, erstlaufRot);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.grund, `${ALTER_STAND} ist mit Exit 2 abgebrochen: Erstlauf rot: test/text.test.js › gross > leer`);
  assert.equal(pruefung(beleg, ALTER_STAND), 2);
});

test("meldet die Mutationsprüfung lokal einen roten Erstlauf mit benanntem Test, läuft sie nicht noch einmal", (context) => {
  const benannterRoterTest = ['console.error("Abbruch: Erstlauf rot: test/rechnen.test.js › verdopple");', "process.exitCode = 2;", ""].join("\n");
  const { beleg } = umbauMit(context, benannterRoterTest);
  assert.deepEqual(exitCodes(beleg, ALTER_STAND), [2]);
});

test("bricht die Mutationsprüfung einmal ab, wiederholt der Lauf nur diesen Schritt und setzt keinen Agenten neu ein", (context) => {
  const einmalAbbrechen = [
    'import { existsSync, writeFileSync } from "node:fs";',
    'if (existsSync(".git/mutation-abgebrochen")) process.exitCode = 0;',
    `else { writeFileSync(".git/mutation-abgebrochen", ""); console.log(${JSON.stringify(NUR_INFRASTRUKTUR_ZEILE)}); console.error("Abbruch: Netzfehler"); process.exitCode = 2; }`,
    "",
  ].join("\n");
  const { lauf, beleg } = umbauMit(context, einmalAbbrechen);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, ALTER_STAND), [2, 0]);
  assert.deepEqual(beleg.agenten.map(({ rolle }) => rolle), ["bau"]);
});

test("bricht die Mutationsprüfung auch in der Wiederholung ab, hält der Auftrag ohne neue Runde mit „Entscheidung nötig“ an", (context) => {
  const { beleg } = immerAbbrechenMit(context, [NUR_INFRASTRUKTUR_ZEILE, "Abbruch: Netzfehler"]);
  assert.deepEqual(exitCodes(beleg, ALTER_STAND), [2, 2]);
  assert.equal(beleg.runde, 1);
  assert.ok(beleg.entscheidung.text.includes("Ein Werkzeug ist 2-mal abgebrochen"), beleg.entscheidung.text);
});

function mutationsBefehle(context) {
  const { lauf, beleg } = umbauMit(context, 'console.log("grün: keiner überlebt");\n');
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const befehle = beleg.pruefungen.filter(({ name }) => name.startsWith("mutation")).map(({ befehl }) => befehl);
  assert.ok(befehle.length > 0, lauf.stdout + lauf.stderr);
  return befehle;
}

test("ohne jede Variable fährt jede Mutationsprüfung des Auftrags über die CI", (context) => {
  for (const befehl of mutationsBefehle(context)) assert.match(befehl, /^npm --silent run test:mutation -- --in-ci --basis /);
});

const VORSCHAU_ZEILE = "Vorschau alt: 3 Quelldateien, 4 Testdateien, 4 Testgruppen, 120 Mutanten; Schätzung 4 Stryker-Aufrufe × 15 s + 120 Mutanten × 1 s = 3 min; Budget der normalen Mutation 15 min Rechenzeit, davon frei 15 min.";
const BUDGET_ZEILE = "Abbruch: Budget der normalen Mutation erreicht: 15 min Rechenzeit bei 15 min Budget; Teilergebnis bis zum Halt: 2 Stryker-Läufe fertig mit 80 Mutanten, davon 80 getötet, 1 Dateien ganz geprüft, 2 Läufe abgebrochen; kein Zeit-Log; kein Urteil.";
const ENDE_ZEILE = "Mutationslog: Ende nach 15 min, Exit 2: Erstlauf 10 %, Mutanten 85 %, Sperre 0 %";
const ANDERE_ZEILE = "Mutationslog: Sperre nach 2 s Warten erhalten";

function immerAbbrechenMit(context, zeilen) {
  const skript = [...zeilen.map((zeile) => `console.error(${JSON.stringify(zeile)});`), "process.exitCode = 2;", ""].join("\n");
  const ergebnis = umbauMit(context, skript);
  const { lauf, beleg } = ergebnis;
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(beleg.entscheidung.text.startsWith("## Entscheidung nötig\n"), beleg.entscheidung.text);
  return { ...ergebnis, notizPrompt: readFileSync(join(ergebnis.werkzeug, "prompt-notiz.txt"), "utf8") };
}

test("endet die Mutationsprüfung am Budget, läuft sie nicht noch einmal und die Notiz sieht Budget, Schätzung und Dauer", (context) => {
  const { beleg, notizPrompt } = immerAbbrechenMit(context, [ANDERE_ZEILE, VORSCHAU_ZEILE, BUDGET_ZEILE, ENDE_ZEILE]);
  assert.deepEqual(exitCodes(beleg, ALTER_STAND), [2]);
  assert.equal(beleg.grund, `${ALTER_STAND} am Budget beendet, kein Urteil; die Prüfung läuft nicht noch einmal.`);
  assert.ok(notizPrompt.includes(`${VORSCHAU_ZEILE}\n${BUDGET_ZEILE}\n${ENDE_ZEILE}\n`), notizPrompt);
  assert.ok(!notizPrompt.includes(ANDERE_ZEILE), notizPrompt);
});

test("nennt ein anderer Abbruch nur in der Vorschau das Budget, läuft die Mutationsprüfung weiter einmal neu", (context) => {
  const { beleg } = immerAbbrechenMit(context, [VORSCHAU_ZEILE, NUR_INFRASTRUKTUR_ZEILE, "Abbruch: Netzfehler"]);
  assert.deepEqual(exitCodes(beleg, ALTER_STAND), [2, 2]);
  assert.ok(beleg.entscheidung.text.includes("Ein Werkzeug ist 2-mal abgebrochen"), beleg.entscheidung.text);
});

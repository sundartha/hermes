import assert from "node:assert/strict";
import { test } from "node:test";

import { NUR_INFRASTRUKTUR_ZEILE } from "../../tools/mutationspruefung/lauf-einordnung.mjs";
import { exitCodes, MIT_MUTATION, UMGEBAUT } from "./auftrag-lauf-hilfen.js";
import { UMBAU, starte } from "./auftrag-lauf-probe.js";

const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const LAENGER_ALS_EIN_TAKT_MS = 1500;
const ALTER_STAND = "mutation alter Stand";

function mutationImCi(context, mutation) {
  return starte(context, { auftrag: UMBAU, drehbuch: { bau: UMGEBAUT }, dateien: { ...MIT_MUTATION, "mutation.mjs": mutation } });
}

test("scheitert in der CI nur die Infrastruktur, fährt lauf die Mutation genau einmal neu", (context) => {
  const einmalInfrastruktur = [
    'import { existsSync, writeFileSync } from "node:fs";',
    'if (existsSync(".git/mutation-abgebrochen")) process.exitCode = 0;',
    `else { writeFileSync(".git/mutation-abgebrochen", ""); console.log(${JSON.stringify(NUR_INFRASTRUKTUR_ZEILE)}); console.error("Abbruch: Mutationsprüfung in der CI ohne Urteil"); process.exitCode = 2; }`,
    "",
  ].join("\n");
  const { lauf, beleg } = mutationImCi(context, einmalInfrastruktur);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, ALTER_STAND), [EXIT_ABBRUCH, 0]);
});

test("scheitert die Infrastruktur auch beim zweiten Mal, hält lauf nach genau einer Wiederholung an", (context) => {
  const immerInfrastruktur = [`console.log(${JSON.stringify(NUR_INFRASTRUKTUR_ZEILE)});`, 'console.error("Abbruch: Mutationsprüfung in der CI ohne Urteil");', "process.exitCode = 2;", ""].join("\n");
  const { lauf, beleg } = mutationImCi(context, immerInfrastruktur);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, ALTER_STAND), [EXIT_ABBRUCH, EXIT_ABBRUCH]);
});

test("lief die Mutation im CI-Weg wegen eines abgelehnten Pushes lokal und brach ab, fährt lauf sie wie im lokalen Weg einmal neu", (context) => {
  const lokalAbgebrochen = [
    'import { existsSync, writeFileSync } from "node:fs";',
    'if (existsSync(".git/mutation-abgebrochen")) process.exitCode = 0;',
    'else { writeFileSync(".git/mutation-abgebrochen", ""); console.log("Hinweis: Mutationsprüfung läuft lokal, weil der Push nach upstream abgelehnt wurde: Permission denied"); console.error("Abbruch: Netzfehler"); process.exitCode = 2; }',
    "",
  ].join("\n");
  const { lauf, beleg } = mutationImCi(context, lokalAbgebrochen);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, ALTER_STAND), [EXIT_ABBRUCH, 0]);
});

test("lief die Mutation im CI-Weg wegen eines abgelehnten Pushes lokal und nennt einen roten Test im Erstlauf, fährt lauf sie nicht neu", (context) => {
  const lokalErstlaufRot = [
    'console.log("Hinweis: Mutationsprüfung läuft lokal, weil der Push nach upstream abgelehnt wurde: Permission denied");',
    'console.error("Abbruch: Erstlauf rot: test/rechnen.test.js › verdopple");',
    "process.exitCode = 2;",
    "",
  ].join("\n");
  const { lauf, beleg } = mutationImCi(context, lokalErstlaufRot);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, ALTER_STAND), [EXIT_ABBRUCH]);
  assert.equal(beleg.grund, `${ALTER_STAND} ist mit Exit 2 abgebrochen: Erstlauf rot: test/rechnen.test.js › verdopple`);
});

test("steht ein Abbruch in der CI eindeutig fest, fährt lauf die Mutation nicht neu und nennt den Grund aus dem Abbruch", (context) => {
  const erstlaufRot = ['console.error("Abbruch: Erstlauf rot: test/rechnen.test.js › verdopple > sieben");', "process.exitCode = 2;", ""].join("\n");
  const { lauf, beleg } = mutationImCi(context, erstlaufRot);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, ALTER_STAND), [EXIT_ABBRUCH]);
  assert.equal(beleg.grund, `${ALTER_STAND} ist mit Exit 2 abgebrochen: Erstlauf rot: test/rechnen.test.js › verdopple > sieben`);
});

test("ein Abbruch in der CI ohne Hinweis auf Infrastruktur, etwa nach der Höchstzeit, wird nicht wiederholt", (context) => {
  const ohneUrteil = ['console.log("Abbruch: Mutationsprüfung in der CI ohne Urteil: Lauf 1 (in_progress, )");', "process.exitCode = 2;", ""].join("\n");
  const { lauf, beleg } = mutationImCi(context, ohneUrteil);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, ALTER_STAND), [EXIT_ABBRUCH]);
});

test("Fortschrittszeilen der Mutation in der CI stehen im Log von lauf, bevor die Prüfung beendet ist", (context) => {
  const mitFortschritt = [
    'import { appendFileSync } from "node:fs";',
    'appendFileSync(process.env.HERMES_FORTSCHRITT_DATEI, "Fortschritt: Lauf 7, 2 min seit Start: 1 von 3 Teilen grün, 2 laufend, 0 wartend, 0 rot\\n");',
    `await new Promise((fertig) => setTimeout(fertig, ${LAENGER_ALS_EIN_TAKT_MS}));`,
    'console.log("grün: keiner überlebt");',
    "",
  ].join("\n");
  const { lauf } = mutationImCi(context, mitFortschritt);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const zeilen = lauf.stderr.split("\n");
  const fortschritt = zeilen.findIndex((zeile) => zeile.startsWith("Fortschritt: Lauf 7, 2 min seit Start: 1 von 3 Teilen grün"));
  const ende = zeilen.findIndex((zeile) => zeile.startsWith(`lauf: ${ALTER_STAND} grün`));
  assert.ok(fortschritt >= 0 && ende > fortschritt, lauf.stderr);
});

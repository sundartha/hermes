import assert from "node:assert/strict";
import { test } from "node:test";

import { ausgang } from "../../tools/auftrag/ausgang.mjs";
import { BASIS, EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const GRUND = "Der Abnahmetest verlangt ein Verhalten, das der Entwurf ausschließt.";
const AUSSTIEG = `Auftrag passt nicht: ${GRUND}`;
const BISHER_GELESENE_ZEICHEN = 1000;
const SCHLUSSSATZ = "Hier folgt eine lange Erklärung, warum ich aufgehört habe. ";
const LANGER_SCHLUSS = SCHLUSSSATZ.repeat(Math.ceil(BISHER_GELESENE_ZEICHEN / SCHLUSSSATZ.length) + 1);
const MUTANT = "src/text.js:2:10 MethodExpression → text";
const GEAENDERT = { "src/text.js": "export function gross(wort) {\n  return wort.toUpperCase();\n}\n" };
const MUTATION_OHNE_MELDUNG = [
  'const gemeldet = process.argv.includes("--gleichwertig") || process.argv.includes("--alter-stand");',
  "if (!gemeldet) process.exitCode = 1;",
  `console.log(gemeldet ? "grün: keiner überlebt" : ${JSON.stringify(`Verstoß: Mutant überlebt: ${MUTANT}`)});`,
  "",
].join("\n");
const MIT_MUTATION = {
  "mutation.mjs": MUTATION_OHNE_MELDUNG,
  "package.json": BASIS["package.json"].replace('"lint"', '"test:mutation":"node mutation.mjs","lint"'),
};

test("eine Ausstiegszeile weit vor dem Ende einer langen Antwort beendet den Auftrag ohne rote Runde", (context) => {
  const drehbuch = { "bau-antwort": `Ich höre auf.\n${AUSSTIEG}\n${LANGER_SCHLUSS}`, "notiz-antwort": "1. Entwurf klären" };
  const { lauf, beleg } = starte(context, { auftrag: UMBAU, drehbuch });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual([beleg.ausstieg, beleg.runden], [GRUND, []]);
  assert.ok(beleg.entscheidung.text.includes(`\n${AUSSTIEG}\n`), beleg.entscheidung.text);
});

test("eine Ausweg-Zeile zählt nur in Spalte 0 außerhalb von Code-Blöcken und nicht mit einem Platzhalter als Grund", () => {
  const nichtGezaehlt = [
    ["```", AUSSTIEG, "```"].join("\n"),
    ["Zum Schluss ein Beispiel:", "```", AUSSTIEG].join("\n"),
    `> ${AUSSTIEG}`,
    `  ${AUSSTIEG}`,
    "Auftrag passt nicht: <Grund in einem Satz>",
    "Alter Test hält altes Verhalten fest: <Testdatei>:<Testname> – <Grund>",
    "Gleichwertig: <Mutant>, weil <ein Satz>",
    "Gleichwertig: src/rechnen.js:3 BooleanLiteral, weil <ein Satz>",
  ];
  for (const antwort of nichtGezaehlt) {
    const weg = ausgang(antwort, "bau");
    assert.deepEqual([weg.ausstieg, weg.alterTest, weg.gleichwertig], [null, null, []], antwort);
  }
  assert.equal(ausgang(["```", "Code", "```", AUSSTIEG].join("\n"), "bau").ausstieg, GRUND);
});

test("stehen mehrere Ausweg-Zeilen in der Antwort, gilt die letzte, die die Rolle benutzen darf", () => {
  const antwort = ["Voraussetzung fehlt: Erst src/a.js aufräumen.", AUSSTIEG, "Voraussetzung fehlt: Der Bereich braucht eine neue Tabelle."].join("\n");
  assert.deepEqual(
    [ausgang(antwort, "bau"), ausgang(antwort, "test")].map(({ ausstieg, voraussetzung }) => [ausstieg, voraussetzung]),
    [
      [null, "Der Bereich braucht eine neue Tabelle."],
      [GRUND, null],
    ],
  );
  assert.deepEqual(ausgang(AUSSTIEG, "notiz").ausstieg, null);
});

test("eine Gleichwertig-Zeile vor mehr als 1000 Zeichen Text wird in der Mutationsnachrunde angenommen", (context) => {
  const meldung = `Gleichwertig: ${MUTANT}, weil Groß- und Kleinschreibung hier nie vorkommen`;
  const drehbuch = { bau: GEAENDERT, "bau-nachrunde-antwort": `${meldung}\n${LANGER_SCHLUSS}` };
  const { lauf, repo } = starte(context, { auftrag: UMBAU, drehbuch, dateien: MIT_MUTATION });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const nachricht = runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout;
  assert.ok(nachricht.includes(`\n${meldung}\n`), nachricht);
});

const VERDOPPELT = { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" };

test("nennt die Zeile zum alten Test eine Datei, die es vorher nicht gab, gilt sie als „Auftrag passt nicht“", (context) => {
  const zeile = "Alter Test hält altes Verhalten fest: test/gibt-es-nicht.test.js:alt – Der Auftrag ändert das Verhalten.";
  const drehbuch = { bau: VERDOPPELT, "bau-antwort": zeile, "notiz-antwort": "1. Klären" };
  const { lauf, beleg } = starte(context, { auftrag: UMBAU, drehbuch });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual([beleg.ausstieg, beleg.runden], [zeile, []]);
  assert.ok(beleg.entscheidung.text.includes(`\nAuftrag passt nicht: ${zeile}\n`), beleg.entscheidung.text);
});

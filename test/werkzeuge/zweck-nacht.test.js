import assert from "node:assert/strict";
import { test } from "node:test";

import { kenntZweck, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { auftragstext } from "../../tools/ziele/agentenlauf.mjs";
import { IDS, ZWECK_JE_ID, meldeBefunde, zweckAbsaetze, zweckVon } from "../../tools/ziele/befunde.mjs";
import { SORTEN } from "../../tools/ziele/sorten.mjs";
import { nurGenutzteIds, quelltext } from "./zweck-quellen.js";

const BEREICH = "nacht";
const OHNE_BLOCK = new Map([
  [IDS.zeit, "Zeitgrenze des Agenten, der Lauf endet grün, kein Agent und kein Mensch muss handeln"],
  [IDS.budget, "Budget aufgebraucht, der Lauf endet grün"],
  [IDS.prRot, "N1: eigener PR rot und geschlossen, die Vorprüfung blockiert nur und entscheidet ohne Agent"],
  [IDS.prAnlage, "N9: Push, PR oder Auto-Merge gescheitert, technischer Fehler; der feste Text nennt die Sperre schon"],
  [IDS.pause, "N2: Pause nach Rücknahme ohne Issue, Leser ist Antonio, kein Agent wählt das Ziel"],
]);
const LAUF = "https://github.com/sundartha/hermes/actions/runs/1";

function sortenIds() {
  return SORTEN.map((sorte) => `nacht/sorte-${sorte}`);
}

function scheinGithub() {
  const issues = [];
  return {
    issues,
    hole: async () => ({}),
    alle: async () => [],
    sende: async (methode, pfad, rumpf) => {
      if (methode === "POST" && pfad === "/issues") issues.push({ number: issues.length + 1, ...rumpf });
      return { number: issues.length };
    },
  };
}

test("tools/zweck/nacht.json hat genau die IDs der Befunde, der Basislinien und der Sorten", () => {
  nurGenutzteIds(BEREICH, sortenIds());
});

test("jede Befund-ID des Aufräumens hat einen Zweck-Text oder steht mit Grund in der Liste ohne Block", () => {
  const ids = Object.values(IDS);
  assert.deepEqual(Object.keys(ZWECK_JE_ID).filter((id) => !ids.includes(id)), []);
  assert.deepEqual(ids.filter((id) => ZWECK_JE_ID[id] === undefined && !OHNE_BLOCK.has(id)), []);
  for (const id of OHNE_BLOCK.keys()) assert.equal(ZWECK_JE_ID[id], undefined, `${id} hat einen Text und steht trotzdem in der Liste ohne Block`);
  for (const zweck of Object.values(ZWECK_JE_ID)) assert.ok(kenntZweck(zweck), zweck);
});

test("jede Sorte mit Agent bekommt ihren Zweck-Block im Auftrag an den Agenten", () => {
  for (const sorte of SORTEN) {
    const text = auftragstext({ datei: "src/ziel.js", sorte, zielbefunde: ["eins"] });
    const zeilen = text.split("\n");
    const block = zweckBlock(`nacht/sorte-${sorte}`);
    const anfang = zeilen.indexOf(block[0]);
    assert.ok(anfang > zeilen.findIndex((zeile) => zeile.startsWith("Ändere nur ")), text);
    assert.deepEqual(zeilen.slice(anfang, anfang + block.length), block);
    assert.match(text, /^Ziel: src\/ziel\.js$/m);
  }
});

test("ein Befund-Issue nennt nach dem festen Text den Block als eigene Absätze, eine Basislinie den Block des Kürzens", async () => {
  const github = scheinGithub();
  await meldeBefunde(github, [{ id: IDS.test, datei: "src/frei.js", text: "frei" }, { id: IDS.geschuetzt, datei: "tools/basis/jscpd.json" }, { id: IDS.zeit, datei: "src/zeit.js" }], LAUF);
  const [ziel, basis, zeit] = github.issues.map(({ body }) => body);
  assert.match(ziel, /^Der Lauf hat eine Testdatei geändert; die Prüfung hat den Patch verworfen\.$/m);
  assert.ok(ziel.includes(`\n\n${zweckBlock("nacht/nur-zieldatei").join("\n\n")}\n`), ziel);
  assert.ok(!ziel.includes("frei\n"), ziel);
  assert.ok(basis.includes(zweckBlock("nacht/basis-kuerzen")[0]), basis);
  assert.doesNotMatch(zeit, /Wozu:/);
  assert.equal(zweckVon({ id: IDS.offen, datei: "eslint-suppressions.json" }), "nacht/basis-kuerzen");
  assert.deepEqual(zweckAbsaetze({ id: IDS.pause, datei: "src/a.js" }), []);
});

test("Prüfung und Commit des Aufräumens nennen nach der Verstoßzeile den Block im Lauf-Log", () => {
  for (const [datei, zeile] of [
    ["tools/ziele/pruefen.mjs", "console.error(`Prüfung: Verstoß ${verstoss.id} in ${verstoss.datei}: ${verstoss.text}`);\n    zeigeZweck(verstoss);\n"],
    ["tools/ziele/pr.mjs", "console.error(`Commit: Verstoß ${verstoss.id}: ${verstoss.text}`);\n    zeigeZweck(verstoss);\n"],
  ]) {
    assert.ok(quelltext(datei).includes(zeile), datei);
  }
});

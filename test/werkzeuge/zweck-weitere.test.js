import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ohneZweck, zweckBlock, zweckTexteVereinen } from "../../tools/auftrag/zweck.mjs";
import { REPO_ROOT, runIn } from "./probe-repo.js";

const WEITERE = "tools/zweck";
const ZEIGEN = join(REPO_ROOT, "tools/zweck-zeigen.mjs");
const FELDER = ["liste", "wozu", "behebung", "nichtAngenommen", "ausweg"];
const TITEL = ["Wozu: ", "Echte Behebung: ", "Nicht angenommen: ", "Ausweg: "];
const REGEL = "Keine Umgehung von Prüfungen";
const VERBOTENE_ANFAENGE = [
  "Auftrag passt nicht:",
  "Voraussetzung fehlt:",
  "Gleichwertig:",
  "Nötig:",
  "Alter Test hält altes Verhalten fest:",
  "Zerlegung passt nicht:",
  "Pitch ändern:",
  "Empfehlung:",
  "grün:",
  "rot:",
  "Verstoß:",
  "Bestätigung:",
  "Hinweis:",
  "Abweichung:",
];
const VERBOTENE_WOERTER = [
  "test.json",
  "Pull Requests",
  "actions: read",
  "statuses: read",
  "pull-requests: read",
  " Altverstöße",
  " neue Befunde",
  " Testimporte an internen Modulen",
];
const EXIT_OK = 0;
const EXIT_AUFRUF = 2;

function gelesen(pfad) {
  return JSON.parse(readFileSync(join(REPO_ROOT, pfad), "utf8"));
}

function weitereDateien() {
  if (!existsSync(join(REPO_ROOT, WEITERE))) return [];
  return readdirSync(join(REPO_ROOT, WEITERE))
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ bereich: name.slice(0, -".json".length), eintraege: gelesen(`${WEITERE}/${name}`) }));
}

function weitereEintraege() {
  return weitereDateien().flatMap(({ bereich, eintraege }) =>
    Object.entries(eintraege).map(([id, eintrag]) => ({ bereich, id, eintrag })),
  );
}

function zeigen(ids) {
  return runIn(REPO_ROOT, process.execPath, [ZEIGEN, ...ids]);
}

test("jede Datei unter tools/zweck/ hat das Format von zweck.json und IDs mit ihrem Bereich als Präfix", () => {
  for (const { bereich, id, eintrag } of weitereEintraege()) {
    assert.ok(id.startsWith(`${bereich}/`), `${id} beginnt nicht mit ${bereich}/`);
    assert.deepEqual(Object.keys(eintrag).toSorted(), FELDER.toSorted(), id);
    for (const feld of FELDER) assert.ok(typeof eintrag[feld] === "string" && eintrag[feld].trim() !== "", `${id}.${feld} ist leer`);
  }
});

test("keine Zweck-ID steht zweimal, auch nicht zwischen zweck.json und tools/zweck/", () => {
  const ids = [...Object.keys(gelesen("tools/auftrag/zweck.json")), ...weitereEintraege().map(({ id }) => id)];
  assert.equal(new Set(ids).size, ids.length);
  const quellen = [
    ["tools/auftrag/zweck.json", { lint: { wozu: "eins" } }],
    ["tools/zweck/basis.json", { lint: { wozu: "zwei" } }],
  ];
  assert.throws(() => zweckTexteVereinen(quellen), /lint steht doppelt: in tools\/auftrag\/zweck\.json und in tools\/zweck\/basis\.json/);
});

test("jeder Text unter tools/zweck/ nennt bei Nicht angenommen die Regel Keine Umgehung von Prüfungen", () => {
  for (const { id, eintrag } of weitereEintraege()) assert.ok(eintrag.nichtAngenommen.includes(REGEL), id);
});

test("kein Text unter tools/zweck/ beginnt eine Zeile wie eine Ausstiegs- oder Belegzeile oder nennt ein Wort, das rote Fälle verbieten", () => {
  for (const { id, eintrag } of weitereEintraege()) {
    const zeilen = [...FELDER.flatMap((feld) => eintrag[feld].split("\n")), ...zweckBlock(id)];
    for (const zeile of zeilen) {
      const anfang = VERBOTENE_ANFAENGE.find((praefix) => zeile.trimStart().startsWith(praefix));
      assert.equal(anfang, undefined, `${id}: ${zeile}`);
      const wort = VERBOTENE_WOERTER.find((verboten) => zeile.includes(verboten));
      assert.equal(wort, undefined, `${id}: ${zeile}`);
    }
  }
});

test("zweckBlock findet jede ID unter tools/zweck/, und ohneZweck filtert ihren Block", () => {
  for (const { id, eintrag } of weitereEintraege()) {
    const block = zweckBlock(id);
    assert.deepEqual(block, TITEL.map((titel, index) => `${titel}${eintrag[FELDER[index + 1]]}`), id);
    assert.deepEqual(ohneZweck(["Befund", ...block]), ["Befund"], id);
  }
});

test("zweck-zeigen schreibt die Blöcke der genannten IDs auf stderr", () => {
  const ids = ["jscpd", ...weitereEintraege().map(({ id }) => id).slice(0, 1)];
  const lauf = zeigen(ids);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.equal(lauf.stdout, "");
  assert.equal(lauf.stderr, `${ids.flatMap(zweckBlock).join("\n")}\n`);
});

test("zweck-zeigen scheitert laut an einer unbekannten ID und ohne ID", () => {
  const unbekannt = zeigen(["jscpd", "basis/gibt-es-nicht"]);
  assert.equal(unbekannt.status, EXIT_AUFRUF);
  assert.equal(unbekannt.stdout, "");
  assert.match(unbekannt.stderr, /Kein Zweck-Text für basis\/gibt-es-nicht/);
  assert.doesNotMatch(unbekannt.stderr, /Wozu:/);
  const ohne = zeigen([]);
  assert.equal(ohne.status, EXIT_AUFRUF);
  assert.match(ohne.stderr, /Aufruf: node tools\/zweck-zeigen\.mjs/);
});

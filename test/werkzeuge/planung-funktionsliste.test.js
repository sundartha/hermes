import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dateiKarte, funktionsListe } from "../../tools/auftrag/planung/funktionsliste.mjs";
import { REPO_ROOT, probeRepository, writeFiles } from "./probe-repo.js";

const PROBE = [
  "export function aussen(wert) {",
  "  const doppelt = wert * 2;",
  "  return [1].map(() => {",
  "    var innen = doppelt;",
  "    return innen;",
  "  });",
  "}",
  "export function andere() {",
  "  var eigen = 1;",
  "  return eigen;",
  "}",
  "",
].join("\n");

const FELDER_EINES_EINTRAGS = ["befunde", "bis", "datei", "name", "nummern", "von", "zeilen"];

function bericht(nummer, ...aenderungen) {
  return { nummern: { [nummer]: { aenderungen } } };
}

function mitSymlink(ordner) {
  symlinkSync(join(REPO_ROOT, "node_modules"), join(ordner, "node_modules"));
  return ordner;
}

function funktionsProbe(context) {
  return mitSymlink(
    probeRepository(context, {
      ".gitignore": "node_modules\n",
      "package.json": JSON.stringify({ type: "module" }),
      "eslint.config.js": 'export default [{ rules: { "no-var": "error" } }];\n',
      "eslint-suppressions.json": JSON.stringify({ "src/probe.js": { "no-var": { count: 2 } } }),
      "src/probe.js": PROBE,
    }),
  );
}

function dateiProbe(context) {
  return mitSymlink(
    probeRepository(context, {
      ".gitignore": "node_modules\n",
      "package.json": JSON.stringify({ type: "module" }),
      "src/a.js": "export const a = 1;\n",
      "src/b.js": "export const b = 2;\n",
      "test/a.test.js": 'import { a } from "../src/a.js";\nexport const x = a;\n',
      ".github/CODEOWNERS": "/src/b.js @owner\n",
    }),
  );
}

test("die Liste führt eine innere namenlose Funktion mit ihren Befunden und Nummern auf", (context) => {
  const ordner = funktionsProbe(context);
  const liste = funktionsListe(ordner, [bericht("S1", { datei: "src/probe.js", funktion: "aussen", von: 2, bis: 4 })]);
  assert.deepEqual(
    liste.map(({ name }) => name),
    ["aussen", "anonym ab Zeile 3"],
  );
  const innere = liste.find(({ name }) => name === "anonym ab Zeile 3");
  assert.equal(innere.datei, "src/probe.js");
  assert.deepEqual(innere.befunde, { "no-var": 1 });
  assert.deepEqual(innere.nummern, ["S1"]);
  assert.equal(innere.von, 3);
  assert.equal(innere.bis, 6);
  assert.equal(innere.zeilen, 4);
  for (const eintrag of liste) assert.deepEqual(Object.keys(eintrag).toSorted(), FELDER_EINES_EINTRAGS);
});

test("eine Funktion ohne Überschneidung mit den Änderungsstellen steht nicht in der Liste", (context) => {
  const ordner = funktionsProbe(context);
  const liste = funktionsListe(ordner, [bericht("S1", { datei: "src/probe.js", funktion: "aussen", von: 2, bis: 4 })]);
  assert.equal(liste.some(({ name }) => name === "andere"), false);
});

test("Stellen derselben Funktion aus zwei Berichten ergeben einen Eintrag mit beiden Nummern", (context) => {
  const ordner = funktionsProbe(context);
  const liste = funktionsListe(ordner, [
    bericht("S1", { datei: "src/probe.js", funktion: "aussen", von: 2, bis: 2 }),
    bericht("S2", { datei: "src/probe.js", funktion: "aussen", von: 7, bis: 7 }),
  ]);
  assert.equal(liste.length, 1);
  assert.equal(liste[0].name, "aussen");
  assert.deepEqual(liste[0].nummern, ["S1", "S2"]);
});

test("Stellen mit neu oder ohne Zeilen ergeben eine leere Liste", (context) => {
  const ordner = funktionsProbe(context);
  const liste = funktionsListe(ordner, [
    bericht("S1", { datei: "src/probe.js", funktion: "neueFunktion", neu: "funktion" }, { datei: "src/neu.js", neu: "datei" }),
    bericht("S2", { datei: "src/probe.js", funktion: "aussen" }),
  ]);
  assert.deepEqual(liste, []);
});

test("eine Shell-Datei ohne ESLint-Konfiguration bekommt keine Karte und bleibt in der Dateikarte", async (context) => {
  const ordner = funktionsProbe(context);
  writeFiles(ordner, {
    "scripts/probe.sh": "#!/bin/sh\necho probe\nexit 0\n",
    "test/probe.test.js": 'import "../src/probe.js";\n',
  });
  const berichte = [bericht("S1", { datei: "src/probe.js", funktion: "andere", von: 9, bis: 9 }, { datei: "scripts/probe.sh", von: 2, bis: 2 })];
  const liste = funktionsListe(ordner, berichte);
  assert.deepEqual(
    liste.map(({ datei, name }) => `${datei}:${name}`),
    ["src/probe.js:andere"],
  );
  const karte = await dateiKarte(ordner, berichte);
  assert.deepEqual(
    karte.map(({ datei, nummern }) => `${datei}:${nummern.join(",")}`),
    ["scripts/probe.sh:S1", "src/probe.js:S1"],
  );
});

test("eine JavaScript-Datei mit Syntaxfehler bricht die Liste weiter mit der ESLint-Meldung ab", (context) => {
  const ordner = funktionsProbe(context);
  writeFiles(ordner, { "src/kaputt.js": "export function kaputt( {\n" });
  assert.throws(
    () => funktionsListe(ordner, [bericht("S1", { datei: "src/kaputt.js", funktion: "kaputt", von: 1, bis: 1 })]),
    /ESLint konnte src\/kaputt\.js nicht prüfen/,
  );
});

test("eine nicht lesbare ESLint-Konfiguration bricht die Liste laut ab", (context) => {
  const ordner = funktionsProbe(context);
  writeFiles(ordner, { "eslint.config.js": "export default [;\n" });
  assert.throws(
    () => funktionsListe(ordner, [bericht("S1", { datei: "src/probe.js", funktion: "aussen", von: 2, bis: 2 })]),
    /ESLint konnte nicht sagen, welche Dateien es prüft/,
  );
});

test("eine Stelle außerhalb des Repos wird nicht still übersprungen", (context) => {
  const ordner = funktionsProbe(context);
  assert.throws(() => funktionsListe(ordner, [bericht("S1", { datei: "../draussen.js", funktion: "fremd", von: 1, bis: 1 })]), /Datei fehlt: \.\.\/draussen\.js/);
});

test("die Dateikarte nennt je Datei Tests, CODEOWNERS und Nummern aus allen Berichten, sortiert", async (context) => {
  const ordner = dateiProbe(context);
  const karte = await dateiKarte(ordner, [
    bericht("S2", { datei: "src/b.js", funktion: "b", von: 1, bis: 1 }),
    bericht("S1", { datei: "src/a.js", funktion: "a", von: 1, bis: 1 }, { datei: "src/b.js", funktion: "b", von: 1, bis: 1 }),
  ]);
  assert.deepEqual(
    karte.map(({ datei }) => datei),
    ["src/a.js", "src/b.js"],
  );
  const [a, b] = karte;
  assert.deepEqual(a.tests, ["test/a.test.js"]);
  assert.equal(a.codeowners, false);
  assert.deepEqual(a.nummern, ["S1"]);
  assert.equal(b.codeowners, true);
  assert.deepEqual(b.tests, []);
  assert.deepEqual(b.nummern, ["S1", "S2"]);
  for (const eintrag of karte) {
    assert.deepEqual(Object.keys(eintrag).toSorted(), ["bereich", "codeowners", "datei", "kritisch", "nummern", "tests"]);
  }
});

test("die Dateikarte stuft Abrechnungsdateien als kritisch ein und kennt den Bereich", async (context) => {
  const ordner = dateiProbe(context);
  const karte = await dateiKarte(ordner, [
    bericht(
      "S1",
      { datei: "src/billing/irgendwas.js", neu: "datei" },
      { datei: "src/a.js", funktion: "a", von: 1, bis: 1 },
      { datei: "src/plans.js", neu: "datei" },
      { datei: "README.md", neu: "datei" },
    ),
  ]);
  const nachDatei = Object.fromEntries(karte.map((eintrag) => [eintrag.datei, eintrag]));
  assert.equal(nachDatei["src/billing/irgendwas.js"].kritisch, true);
  assert.equal(nachDatei["src/a.js"].kritisch, false);
  assert.equal(nachDatei["src/plans.js"].bereich, "abrechnung");
  assert.equal(nachDatei["README.md"].bereich, null);
});

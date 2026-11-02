import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, probeDirectory, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const PHASE = "F-001-probe";
const BESTEHENDE_HILFE = "test/gemeinsam/helfer.js";
const NEUE_HILFE = "test/gemeinsam/neue-attrappe.js";
const ALTER_TEST = "test/alt.test.js";
const TESTORDNUNG = /neue Testdateien liegen unter test\/<bereich>\//;
const TESTHILFE = /erwarteteDateien lässt lauf nach dem Test-Agenten abbrechen mit „Der Test-Agent hat eine bestehende Testhilfe geändert: /;
const ABHAENGIGKEITSREGELN = { ".dependency-cruiser.cjs": "module.exports = { forbidden: [] };\n" };
const BESTAND = {
  "tools/bereiche.json": JSON.stringify([{ bereich: "abrechnung" }, { bereich: "gemeinsam" }]),
  "src/d.js": "export const WERT = 1;\n",
  [BESTEHENDE_HILFE]: "export const HILFE = 1;\n",
  [ALTER_TEST]: 'import { test } from "node:test";\ntest("alt", () => {});\n',
};

function behebung(felder = {}) {
  const abnahme = felder.abnahme ?? "test/abrechnung/antwortfrist.test.js";
  return {
    id: "a1",
    art: "fehlerbehebung",
    ziel: "Antworte innerhalb der Frist",
    bereich: "src/d.js",
    erwarteteDateien: ["src/d.js", abnahme],
    abnahme,
    erwarteterFehler: "Expected values to be strictly equal",
    wasDarfNiePassieren: ["Ein Kunde wartet länger als die Frist auf eine Antwort."],
    ...felder,
  };
}

function testumbau(felder = {}) {
  return {
    id: "u1",
    art: "testumbau",
    ziel: "Ziehe die Testdaten in die gemeinsame Hilfe",
    bereich: "test/",
    erwarteteDateien: [BESTEHENDE_HILFE, ALTER_TEST],
    abnahme: ALTER_TEST,
    ...felder,
  };
}

function repo(context, dateien = ABHAENGIGKEITSREGELN) {
  return probeRepository(context, { ...BESTAND, ...dateien });
}

function pruefe(ordner, auftraege) {
  writeFiles(ordner, { "phase.json": JSON.stringify({ phase: PHASE, issue: 7, entwurf: { "src/d.js": "Entwurf", "test/": "Entwurf" }, auftraege }) });
  return runIn(ordner, process.execPath, [EINSTIEG, "pruefe", "phase.json"]);
}

function befundzeilen(lauf) {
  return lauf.stderr.split("\n").filter((zeile) => zeile !== "");
}

test("auftrag-pruefe vor lauf: eine neue Abnahme außerhalb eines Bereichsordners ist rot wie bei lauf, im Bereichsordner grün", (context) => {
  const ordner = repo(context);
  const rot = pruefe(ordner, [behebung({ abnahme: "test/billing/antwortfrist.test.js" })]);
  assert.equal(rot.status, EXIT_ROT, rot.stdout);
  assert.equal(befundzeilen(rot).length, 1, rot.stderr);
  assert.match(rot.stderr, /^a1: test\/billing\/antwortfrist\.test\.js: neue Testdateien liegen unter test\/<bereich>\/ \(Bereiche: abrechnung, gemeinsam\)/m);
  assert.match(rot.stdout, /^rot: 1 Befunde in phase\.json\.$/m);
  const gruen = pruefe(ordner, [behebung()]);
  assert.equal(gruen.status, EXIT_GRUEN, gruen.stderr);
  assert.match(gruen.stdout, /^grün: 1 Aufträge in phase\.json sind vollständig\.$/m);
});

test("auftrag-pruefe vor lauf: eine neue Testdatei mit Ticket-Namen in erwarteteDateien ist rot", (context) => {
  const lauf = pruefe(repo(context), [behebung({ erwarteteDateien: ["src/d.js", "test/abrechnung/antwortfrist.test.js", "test/abrechnung/p4-attrappe.js"] })]);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout);
  assert.match(lauf.stderr, /^a1: test\/abrechnung\/p4-attrappe\.js: neue Testdateien liegen unter test\/<bereich>\//m);
});

test("auftrag-pruefe vor lauf: eine bestehende Testdatei außerhalb eines Bereichsordners bleibt als Abnahme grün", (context) => {
  const lauf = pruefe(repo(context), [behebung({ abnahme: ALTER_TEST, erwarteteDateien: ["src/d.js", ALTER_TEST] })]);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
});

test("auftrag-pruefe vor lauf: ohne Abhängigkeitsregeln im Repo prüft pruefe die Testordnung nicht, weil lauf sie dann auch nicht prüft", (context) => {
  const lauf = pruefe(repo(context, {}), [behebung({ abnahme: "test/billing/antwortfrist.test.js" })]);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
  assert.doesNotMatch(lauf.stderr, TESTORDNUNG);
});

test("auftrag-pruefe vor lauf: eine bestehende Testhilfe in erwarteteDateien einer Fehlerbehebung ist rot, in einem testumbau grün", (context) => {
  const ordner = repo(context);
  const rot = pruefe(ordner, [behebung({ erwarteteDateien: ["src/d.js", "test/abrechnung/antwortfrist.test.js", BESTEHENDE_HILFE] })]);
  assert.equal(rot.status, EXIT_ROT, rot.stdout);
  assert.deepEqual(befundzeilen(rot), [
    "a1: erwarteteDateien lässt lauf nach dem Test-Agenten abbrechen mit „Der Test-Agent hat eine bestehende Testhilfe geändert: test/gemeinsam/helfer.js; Testhilfen ändert nur ein testumbau“",
  ]);
  const gruen = pruefe(ordner, [testumbau()]);
  assert.equal(gruen.status, EXIT_GRUEN, gruen.stderr);
});

test("auftrag-pruefe vor lauf: eine neue Testhilfe legt der erste Auftrag an; ändert sie ein späterer Auftrag derselben Phase, ist nur dieser rot", (context) => {
  const ordner = repo(context);
  const erster = behebung({ erwarteteDateien: ["src/d.js", "test/abrechnung/antwortfrist.test.js", NEUE_HILFE] });
  const allein = pruefe(ordner, [erster]);
  assert.equal(allein.status, EXIT_GRUEN, allein.stderr);
  const zweiter = behebung({ id: "a2", abhaengigVon: ["a1"], abnahme: "test/abrechnung/zweite-frist.test.js", erwarteteDateien: ["src/d.js", "test/abrechnung/zweite-frist.test.js", NEUE_HILFE] });
  const beide = pruefe(ordner, [zweiter, erster]);
  assert.equal(beide.status, EXIT_ROT, beide.stdout);
  assert.deepEqual(befundzeilen(beide).filter((zeile) => TESTHILFE.test(zeile)).map((zeile) => zeile.split(":")[0]), ["a2"]);
});

test("auftrag-pruefe vor lauf: ein schon gebauter Auftrag macht die Phase mit seiner angelegten Testhilfe nicht rot", (context) => {
  const ordner = repo(context);
  const gebaut = behebung({ erwarteteDateien: ["src/d.js", "test/abrechnung/antwortfrist.test.js", NEUE_HILFE] });
  writeFiles(ordner, { [NEUE_HILFE]: "export const NEU = 1;\n", "test/abrechnung/antwortfrist.test.js": BESTAND[ALTER_TEST] });
  commitAll(ordner, `Antworte innerhalb der Frist\n\nAuftrag: ${PHASE}/a1\nArt: fehlerbehebung`);
  const gruen = pruefe(ordner, [gebaut]);
  assert.equal(gruen.status, EXIT_GRUEN, gruen.stderr);
  const spaeter = behebung({ id: "a2", abhaengigVon: ["a1"], abnahme: "test/abrechnung/zweite-frist.test.js", erwarteteDateien: ["src/d.js", "test/abrechnung/zweite-frist.test.js", NEUE_HILFE] });
  const rot = pruefe(ordner, [gebaut, spaeter]);
  assert.equal(rot.status, EXIT_ROT, rot.stdout);
  assert.deepEqual(befundzeilen(rot).map((zeile) => zeile.split(":")[0]), ["a2"]);
});

test("auftrag-pruefe vor lauf: eine .ts-Testdatei außerhalb eines Bereichsordners ist rot, mit vorhandenem .js-Zwilling grün, weil erst der Bau zeigt, ob sie nur umbenannt ist", (context) => {
  const ordner = repo(context);
  const auftrag = behebung({ erwarteteDateien: ["src/d.js", "test/abrechnung/antwortfrist.test.js", "test/billing/frist.test.ts"] });
  const rot = pruefe(ordner, [auftrag]);
  assert.equal(rot.status, EXIT_ROT, rot.stdout);
  assert.match(rot.stderr, /^a1: test\/billing\/frist\.test\.ts: neue Testdateien liegen unter test\/<bereich>\//m);
  writeFiles(ordner, { "test/billing/frist.test.js": BESTAND[ALTER_TEST] });
  const gruen = pruefe(ordner, [auftrag]);
  assert.equal(gruen.status, EXIT_GRUEN, gruen.stderr);
});

test("auftrag-pruefe vor lauf: lassen sich die gebauten Aufträge nicht bestimmen, meldet pruefe keine Testhilfe, die Testordnung aber weiter", (context) => {
  const ordner = probeDirectory(context, { ...BESTAND, ...ABHAENGIGKEITSREGELN });
  const hilfe = pruefe(ordner, [behebung({ erwarteteDateien: ["src/d.js", "test/abrechnung/antwortfrist.test.js", BESTEHENDE_HILFE] })]);
  assert.equal(hilfe.status, EXIT_GRUEN, hilfe.stderr);
  assert.doesNotMatch(hilfe.stderr, TESTHILFE);
  const ordnung = pruefe(ordner, [behebung({ abnahme: "test/billing/antwortfrist.test.js" })]);
  assert.equal(ordnung.status, EXIT_ROT, ordnung.stdout);
  assert.match(ordnung.stderr, TESTORDNUNG);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { geteiltBeiZeitgrenze, GRUPPE, gruppen, zeitgrenzeGemeldet } from "../../tools/mutationspruefung/gruppen.mjs";
import { aufrufzeileRot, BASIS, begleiter, BESCHREIBUNG, beschreibungstest, EXIT_ROT, laufgroessen, NEGATIV, NULL, protokolltest, pruefe, quelle, spaltenweise, testdatei, testdateien, VIELE_TESTDATEIEN } from "./mutationspruefung-hilfen.js";
import { probeRepository, writeFiles } from "./probe-repo.js";

test("die Testdateien gehen reihum in so wenige Gruppen, dass keine mehr als GRUPPE Dateien hat", () => {
  for (const anzahl of [0, 1, GRUPPE, GRUPPE + 1, VIELE_TESTDATEIEN]) {
    const dateien = testdateien(anzahl);
    const verteilt = gruppen(dateien);
    assert.equal(verteilt.length, Math.ceil(anzahl / GRUPPE));
    assert.ok(verteilt.every((gruppe) => gruppe.length > 0 && gruppe.length <= GRUPPE));
    assert.deepEqual(spaltenweise(verteilt), dateien);
  }
});

test("tötet nur eine Testdatei der zweiten Gruppe einen Mutanten, wird er erkannt", (context) => {
  const repo = probeRepository(context, { ...BASIS, ...begleiter(testdatei([1, "positiv"])) });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.match(rot.stdout, /^Verstoß: Mutant überlebt: src\/zahl\.js:3:/m);
  writeFiles(repo, begleiter(testdatei([1, "positiv"]), testdatei([0, "null"])));
  const gruen = pruefe(repo, "--basis", "HEAD");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
  const groessen = laufgroessen(gruen.stdout);
  assert.equal(groessen.reduce((summe, anzahl) => summe + anzahl, 0), GRUPPE + 1);
  assert.ok(groessen.length > 1 && groessen.every((anzahl) => anzahl <= GRUPPE), gruen.stdout);
});

test("ein Mutant, den der direkte Test übersieht, geht nur an die übrigen erreichenden Testdateien", (context) => {
  const repo = probeRepository(context, {
    ...BASIS,
    "src/beschreibung.js": BESCHREIBUNG,
    "test/beschreibung.test.js": beschreibungstest(1, "POSITIV"),
  });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.deepEqual(laufgroessen(rot.stdout), [1, 1]);
  writeFiles(repo, { "test/beschreibung.test.js": beschreibungstest(0, "NULL") });
  const gruen = pruefe(repo, "--basis", "HEAD");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
});

test("die Löschprobe fragt Gruppe um Gruppe, bis eine die gelöschte Zeile verlangt", (context) => {
  const ohneProtokoll = protokolltest('assert.equal(zahl.einordnen(-1), "negativ");');
  const repo = aufrufzeileRot(context, begleiter(ohneProtokoll));
  writeFiles(repo, begleiter(ohneProtokoll, protokolltest('assert.equal(zahl.einordnen(-1), "negativ");', "assert.deepEqual(zahl.protokoll, [-1]);")));
  const gruen = pruefe(repo, "--basis", "HEAD");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
});

test("ein gescheiterter Erstlauf zählt nur als Zeitgrenze, wenn die Mitschrift die Zeitgrenze meldet und keinen Fehler-Status", () => {
  const gescheitert = new Error("Something went wrong in the initial test run");
  const zeitgrenze = "Initial test run timed out! Ran 0 tests\n";
  const fehlerStatus = "One or more tests resulted in an error:\n\ttest/probe.test.js\n";
  const faelle = [
    { mitschrift: [zeitgrenze], erwartet: true },
    { mitschrift: [fehlerStatus], erwartet: false },
    { mitschrift: [zeitgrenze, fehlerStatus], erwartet: false },
    { mitschrift: [], erwartet: false },
  ];
  for (const { mitschrift, erwartet } of faelle) {
    assert.equal(zeitgrenzeGemeldet(gescheitert, mitschrift), erwartet, mitschrift.join(""));
  }
  assert.equal(zeitgrenzeGemeldet(new Error("There were failed tests in the initial test run."), [zeitgrenze]), false);
});

test("läuft der Erstlauf einer Gruppe über die Zeitgrenze, wird sie halbiert, bis jeder Teil durchläuft; eine einzelne Datei darüber und jeder andere Fehler brechen ab", async () => {
  const groessteDurchlaufendeGruppe = 2;
  const gruppengroesse = 5;
  const zeitgrenze = new Error("Zeitgrenze");
  const ueber = (fehler) => fehler === zeitgrenze;
  const gelaufen = [];
  const laufen = async (tests) => {
    gelaufen.push(tests);
    if (tests.length > groessteDurchlaufendeGruppe) throw zeitgrenze;
    return tests;
  };
  const dateien = testdateien(gruppengroesse);
  assert.deepEqual(await geteiltBeiZeitgrenze(dateien, laufen, ueber), [dateien.slice(0, 2), [dateien[2]], dateien.slice(3)]);
  assert.deepEqual(gelaufen, [dateien, dateien.slice(0, 3), dateien.slice(0, 2), [dateien[2]], dateien.slice(3)]);
  const immer = async () => {
    throw zeitgrenze;
  };
  await assert.rejects(geteiltBeiZeitgrenze(dateien, immer, ueber), zeitgrenze);
  const anderer = new Error("rot");
  let versuche = 0;
  const rot = async () => {
    versuche += 1;
    throw anderer;
  };
  await assert.rejects(geteiltBeiZeitgrenze(dateien, rot, ueber), anderer);
  assert.equal(versuche, 1);
});

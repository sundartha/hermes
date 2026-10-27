import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { KOPIEN_LISTE, ROTER_TEST, VERDOPPELT, funktion, pruefung } from "./auftrag-lauf-hilfen.js";
import { BASIS, EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";

const JSCPD = "jscpd";
const WOZU = "Wozu: Zwei Kopien derselben Logik lassen sich nur gemeinsam richtig ändern";
const ABSATZ = `Zweck ${JSCPD}: Drehbuchtext des Ersatz-Agenten.`;
const RUMPF = [
  "  const wort = String(text).trim();",
  '  if (wort.length === 0) throw new Error("leeres Wort kann nicht umgewandelt werden");',
  "  const teile = wort.split(/\\s+/).filter((teil) => teil.length > 0);",
  "  return teile.map((teil) => teil.toUpperCase()).join(\" \");",
  "}",
];
const MIT_KOPIE = ["export function gross(text) {", ...RUMPF, "", "export function laut(text) {", ...RUMPF, ""].join("\n");
const FALL = [
  "  const ergebnis = verdopple(2);",
  '  assert.equal(ergebnis, 4, "verdopple(2) soll 4 ergeben");',
  '  assert.ok(Number.isInteger(ergebnis), "das Ergebnis soll ganzzahlig sein");',
  '  assert.notEqual(ergebnis, 2, "das Ergebnis soll nicht die Eingabe sein");',
  "});",
];
const TEST_MIT_KOPIE = [...ROTER_TEST.split("\n").slice(0, 3), 'test("verdoppelt zwei", () => {', ...FALL, 'test("verdoppelt zwei noch einmal", () => {', ...FALL, ""].join("\n");

function namen(beleg) {
  return beleg.pruefungen.map(({ name }) => name);
}

function rotAnJscpd(lauf, beleg) {
  const ergebnis = { status: lauf.status, ergebnis: beleg.ergebnis, grund: beleg.grund, exitCode: pruefung(beleg, JSCPD) };
  assert.deepEqual(ergebnis, { status: EXIT_ROT, ergebnis: "rot", grund: `${JSCPD} endete mit Exit ${EXIT_ROT}.`, exitCode: EXIT_ROT }, lauf.stdout + lauf.stderr);
}

test("die Kopien-Prüfung läuft im Bau direkt nach feste-pfade und ist grün, wenn der Bau keine neue Kopie schreibt", (context) => {
  const drehbuch = { bau: { "src/text.js": "export function gross(wort) {\n  return wort.toUpperCase();\n}\n" } };
  const { lauf, beleg } = starte(context, { auftrag: UMBAU, drehbuch, dateien: KOPIEN_LISTE });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const liste = namen(beleg);
  assert.equal(liste[liste.indexOf("feste-pfade") + 1], JSCPD, liste.join(", "));
  assert.equal(pruefung(beleg, JSCPD), 0, JSON.stringify(beleg.pruefungen));
});

test("schreibt der Bau-Agent eine Funktion doppelt, wird die Runde an jscpd rot, und die zweite Runde des Bau-Agenten bekommt Befund und Zweck-Text", (context) => {
  const drehbuch = { bau: { "src/text.js": MIT_KOPIE }, "bau-antwort": ABSATZ };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: UMBAU, drehbuch, dateien: KOPIEN_LISTE });
  rotAnJscpd(lauf, beleg);
  const zweiteRunde = readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8");
  for (const teil of ["src/text.js:1-6 gleicht src/text.js:8-13", WOZU, `dem Bau-Agenten: ${JSCPD}`]) assert.ok(zweiteRunde.includes(teil), `${teil}\n${zweiteRunde}`);
});

test("die Kopien-Prüfung läuft nach dem Test-Agenten direkt nach der statischen Testprüfung, vor dem Rot-Lauf", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };
  const { lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: KOPIEN_LISTE });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const liste = namen(beleg);
  assert.equal(liste[liste.indexOf("tests/statisch") + 1], JSCPD, liste.join(", "));
  assert.ok(liste.indexOf(JSCPD) < liste.indexOf("rot"), liste.join(", "));
});

test("schreibt der Test-Agent zwei Testfälle mit gleichem Rumpf, hält lauf vor dem Bau an und gibt dem Test-Agenten Befund und Zweck-Text", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": TEST_MIT_KOPIE }, "test-antwort": ABSATZ, bau: { "src/rechnen.js": VERDOPPELT } };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: KOPIEN_LISTE });
  rotAnJscpd(lauf, beleg);
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
  const zweiteRunde = readFileSync(join(werkzeug, "prompt-test.txt"), "utf8");
  for (const teil of ["gleicht test/rechnen.test.js:", WOZU, `dem Test-Agenten: ${JSCPD}`]) assert.ok(zweiteRunde.includes(teil), `${teil}\n${zweiteRunde}`);
});

test("fehlt tools/basis/jscpd.json schon auf der Basis, entfällt die Kopien-Prüfung in beiden Stufen mit genau einem Hinweis", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };
  const { lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(!namen(beleg).includes(JSCPD), namen(beleg).join(", "));
  assert.equal(beleg.hinweise.filter((hinweis) => hinweis.includes("tools/basis/jscpd.json")).length, 1, JSON.stringify(beleg.hinweise));
});

test("löscht der Bau-Agent tools/basis/jscpd.json, entfällt die Kopien-Prüfung nicht, sondern die Runde wird an jscpd rot", (context) => {
  const auftrag = { ...UMBAU, bereich: "tools/", erwarteteDateien: ["tools/basis/jscpd.json"] };
  const drehbuch = { "bau-loeschen": ["tools/basis/jscpd.json"], "bau-antwort": ABSATZ };
  const { lauf, beleg } = starte(context, { auftrag, drehbuch, dateien: KOPIEN_LISTE });
  rotAnJscpd(lauf, beleg);
});

const TESTUMBAU = { ...UMBAU, art: "testumbau", ziel: "Ziehe die Rechen-Tests in eine eigene Datei", bereich: "test/", erwarteteDateien: ["test/rechnen.test.js"], vorbild: "test/text.test.js" };
const PAKET = JSON.parse(BASIS["package.json"]);
const MUTATION = "mutation testumbau";
const MIT_MUTATION_UND_KOPIEN = { ...KOPIEN_LISTE, "src/rechnen.js": VERDOPPELT, "package.json": JSON.stringify({ ...PAKET, scripts: { ...PAKET.scripts, "test:mutation": "node -e 0 --" } }) };

function testumbau(context, drehbuch) {
  return starte(context, { auftrag: TESTUMBAU, drehbuch, dateien: MIT_MUTATION_UND_KOPIEN });
}

test("die Kopien-Prüfung läuft im Testumbau direkt nach lint und vor der Mutation", (context) => {
  const { lauf, beleg } = testumbau(context, { test: { "test/rechnen.test.js": ROTER_TEST } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const liste = namen(beleg);
  assert.equal(liste[liste.indexOf("lint") + 1], JSCPD, liste.join(", "));
  assert.ok(liste.indexOf(JSCPD) < liste.indexOf(MUTATION), liste.join(", "));
});

test("schreibt der Testumbau-Agent zwei Testfälle mit gleichem Rumpf, wird die Runde vor der Mutation an jscpd rot und der Testumbau-Agent bekommt Befund und Zweck-Text", (context) => {
  const { werkzeug, lauf, beleg } = testumbau(context, { test: { "test/rechnen.test.js": TEST_MIT_KOPIE }, "test-antwort": ABSATZ });
  rotAnJscpd(lauf, beleg);
  assert.ok(!namen(beleg).includes(MUTATION), namen(beleg).join(", "));
  const zweiteRunde = readFileSync(join(werkzeug, "prompt-test.txt"), "utf8");
  for (const teil of ["## Testumbau", "gleicht test/rechnen.test.js:", WOZU, `dem Test-Agenten: ${JSCPD}`]) assert.ok(zweiteRunde.includes(teil), `${teil}\n${zweiteRunde}`);
});

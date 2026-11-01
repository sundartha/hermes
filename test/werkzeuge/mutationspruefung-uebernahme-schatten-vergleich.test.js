import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, probeDirectory, runIn } from "./probe-repo.js";

const VERGLEICH = join(REPO_ROOT, "tools/mutationspruefung/schatten-vergleich.mjs");
const SCHLUESSEL = "src/zahl.js:2:7 ConditionalExpression";
const GETOETET = { schluessel: SCHLUESSEL, lage: { zeile: 2 }, status: "Killed", bestaetigung: "getoetet", toeter: ["test/zahl.test.js"], zeilen: [2, 2] };
const UEBERLEBT = { ...GETOETET, status: "Survived", bestaetigung: undefined, toeter: [] };
const OHNE_BESTAETIGUNG = { ...GETOETET, bestaetigung: undefined };

function messung(pruefung, eintrag) {
  return { pruefung, ergebnisse: eintrag === undefined ? [] : [eintrag] };
}

function teilbericht(messungen, uebernehmbar) {
  return JSON.stringify({ teil: 1, teile: 1, messungen, schatten: { uebernehmbar } });
}

function vergleich(context, teilberichte) {
  const ordner = probeDirectory(context, Object.fromEntries(teilberichte.map((inhalt, index) => [`mutation-teil-${index + 1}.json`, inhalt])));
  return runIn(REPO_ROOT, process.execPath, [VERGLEICH, ordner]);
}

test("ein als übernehmbar gemeldeter Mutant, der frisch bestätigt getötet wurde, besteht den Schattenvergleich", (context) => {
  const lauf = vergleich(context, [teilbericht([messung(0, GETOETET)], [{ pruefung: 0, schluessel: SCHLUESSEL }])]);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Schattenvergleich: 1 übernehmbare Mutanten, 0 im frischen Lauf nicht bestätigt getötet\./);
});

test("ein als übernehmbar gemeldeter Mutant, der frisch überlebt, scheitert am Schattenvergleich", (context) => {
  const lauf = vergleich(context, [teilbericht([messung(0, UEBERLEBT)], [{ pruefung: 0, schluessel: SCHLUESSEL }])]);
  assert.equal(lauf.status, 1, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, new RegExp(`Abweichung: .*Prüfung 0, ${SCHLUESSEL}`));
});

test("ein als übernehmbar gemeldeter Mutant ohne Bestätigung im frischen Lauf scheitert am Schattenvergleich", (context) => {
  const lauf = vergleich(context, [teilbericht([messung(0, OHNE_BESTAETIGUNG)], [{ pruefung: 0, schluessel: SCHLUESSEL }])]);
  assert.equal(lauf.status, 1, lauf.stdout + lauf.stderr);
});

test("ein als übernehmbar gemeldeter Mutant, der im frischen Lauf fehlt, scheitert am Schattenvergleich", (context) => {
  const lauf = vergleich(context, [teilbericht([messung(0)], [{ pruefung: 0, schluessel: SCHLUESSEL }])]);
  assert.equal(lauf.status, 1, lauf.stdout + lauf.stderr);
});

test("der Schattenvergleich vergleicht den Mutanten mit dem frischen Ergebnis derselben Prüfung", (context) => {
  const lauf = vergleich(context, [teilbericht([messung(0, GETOETET), messung(1, UEBERLEBT)], [{ pruefung: 1, schluessel: SCHLUESSEL }])]);
  assert.equal(lauf.status, 1, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Prüfung 1/);
});

test("ein Lauf ohne gemeldete Schatten-Mutanten besteht den Schattenvergleich", (context) => {
  const lauf = vergleich(context, [teilbericht([messung(0, UEBERLEBT)], [])]);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Schattenvergleich: 0 übernehmbare Mutanten/);
});

test("der Schattenvergleich ohne Ordner ist ein Aufruffehler", () => {
  const lauf = runIn(REPO_ROOT, process.execPath, [VERGLEICH]);
  assert.equal(lauf.status, 2);
  assert.match(lauf.stderr, /Aufruf: node tools\/mutationspruefung\/schatten-vergleich\.mjs/);
});

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { MIT_MUTATION, ROTER_TEST, VERDOPPELT, exitCodes, funktion, namen, pruefung, rotAn } from "./auftrag-lauf-hilfen.js";
import { UMBAU, starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const LINT_NEUE_FUNKTIONEN = "lint neuer funktionen";
const ZWECK = "lint/neue-funktionen";
const ABSATZ = `Zweck ${ZWECK}: Drehbuchtext des Ersatz-Agenten.`;
const MIT_WARNUNG_FUER_AUSGABEN = { "eslint.config.js": 'export default [{ rules: { "no-console": "warn" } }];\n' };
const TEST_MIT_AUSGABE = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { verdopple } from "../src/rechnen.js";',
  'test("verdoppelt", () => {',
  '  console.log("verdopple 2");',
  "  assert.equal(verdopple(2), 4);",
  "});",
  "",
].join("\n");
const GROSS_MIT_AUSGABE = "export function gross(wort) {\n  console.log(wort);\n  return wort.toUpperCase();\n}\n";
const NACH_TEST_UND_NACH_BAU_GRUEN = [0, 0];
const TESTUMBAU = { ...UMBAU, art: "testumbau", ziel: "Ziehe die Rechen-Tests in eine eigene Datei", bereich: "test/", erwarteteDateien: ["test/rechnen.test.js"], vorbild: "test/text.test.js" };

function zweiteRundeEnthaelt(werkzeug, rolle, teile) {
  const prompt = readFileSync(join(werkzeug, `prompt-${rolle}.txt`), "utf8");
  for (const teil of [`${LINT_NEUE_FUNKTIONEN}:`, ...zweckBlock(ZWECK), ...teile]) assert.ok(prompt.includes(teil), `${teil}\n---\n${prompt}`);
}

test("eine Warnung in einer neuen Testfunktion macht die Runde an lint neuer funktionen rot, bevor der Bau-Agent startet, und geht an den Test-Agenten", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": TEST_MIT_AUSGABE }, "test-antwort": ABSATZ };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: MIT_WARNUNG_FUER_AUSGABEN });
  rotAn(LINT_NEUE_FUNKTIONEN, lauf, beleg);
  assert.equal(pruefung(beleg, "rot"), undefined, namen(beleg).join(", "));
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
  zweiteRundeEnthaelt(werkzeug, "test", ["test/rechnen.test.js:5 no-console: Unexpected console statement.", `dem Test-Agenten: ${ZWECK}`]);
  assert.match(beleg.entscheidung.text, /nur an Formprüfungen der Agenten rot \(lint neuer funktionen\)/);
});

test("eine Warnung, die der Bau-Agent noch nicht committet hat, macht die Runde direkt nach lint rot und geht an den Bau-Agenten", (context) => {
  const drehbuch = { bau: { "src/text.js": GROSS_MIT_AUSGABE }, "bau-antwort": ABSATZ };
  const { werkzeug, lauf, beleg, basis, kopf } = starte(context, { auftrag: UMBAU, drehbuch, dateien: MIT_WARNUNG_FUER_AUSGABEN });
  rotAn(LINT_NEUE_FUNKTIONEN, lauf, beleg);
  assert.equal(kopf, basis);
  const liste = namen(beleg);
  assert.equal(liste[liste.indexOf("lint") + 1], LINT_NEUE_FUNKTIONEN, liste.join(", "));
  zweiteRundeEnthaelt(werkzeug, "bau", ["src/text.js:2 no-console: Unexpected console statement.", `dem Bau-Agenten: ${ZWECK}`]);
});

test("eine Warnung im Testumbau macht die Runde vor der Mutation rot und geht an den Test-Agenten", (context) => {
  const dateien = { ...MIT_WARNUNG_FUER_AUSGABEN, "src/rechnen.js": VERDOPPELT };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: TESTUMBAU, drehbuch: { test: { "test/rechnen.test.js": TEST_MIT_AUSGABE }, "test-antwort": ABSATZ }, dateien });
  rotAn(LINT_NEUE_FUNKTIONEN, lauf, beleg);
  zweiteRundeEnthaelt(werkzeug, "test", ["## Testumbau", "test/rechnen.test.js:5 no-console", `dem Test-Agenten: ${ZWECK}`]);
});

test("ohne Befund bleibt die Runde nach Test- und Bau-Agent an lint neuer funktionen grün und hinterlässt nur den Commit des Auftrags", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };
  const { repo, lauf, beleg, basis } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: { ...MIT_MUTATION, ...MIT_WARNUNG_FUER_AUSGABEN } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, LINT_NEUE_FUNKTIONEN), NACH_TEST_UND_NACH_BAU_GRUEN, JSON.stringify(beleg.pruefungen));
  assert.equal(runIn(repo, "git", ["rev-list", "--count", `${basis}..HEAD`]).stdout.trim(), "1");
});

test("ein Repo ohne eslint.config.js meldet das einmal als Hinweis statt lint neuer funktionen zu fahren", (context) => {
  const { lauf, beleg } = starte(context, { auftrag: UMBAU, drehbuch: { bau: { "src/text.js": GROSS_MIT_AUSGABE } } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual({ gelaufen: exitCodes(beleg, LINT_NEUE_FUNKTIONEN), hinweise: beleg.hinweise.filter((hinweis) => hinweis.startsWith("Lint neuer Funktionen")) }, { gelaufen: [], hinweise: ["Lint neuer Funktionen: eslint.config.js fehlt."] });
});

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { exitCodes, funktion, MIT_MUTATION, pruefung, VERDOPPELT } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { REPO_ROOT } from "./probe-repo.js";

const KONFIGURATION = ".dependency-cruiser.cjs";
const ABHAENGIGKEITEN = "abhängigkeiten";
const ABNAHME = "test/rechnen/verdoppeln.test.js";
const ABSATZ_TESTIMPORTE = "Zweck basis/test-importe: Drehbuchtext des Ersatz-Agenten.";
const ABSATZ_REGELN = "Zweck basis/abhaengigkeitsregeln: Drehbuchtext des Ersatz-Agenten.";
const BEREICHE = [
  { bereich: "rechnen", quellen: ["^src/rechnen\\.js$"], eingaenge: ["^src/rechnen\\.js$"], fachlogik: [] },
  { bereich: "text", quellen: ["^src/text\\.js$"], eingaenge: ["^src/text\\.js$"], fachlogik: [] },
];
const MIT_REGELN = {
  [KONFIGURATION]: readFileSync(join(REPO_ROOT, KONFIGURATION), "utf8"),
  "tools/bereiche.json": `${JSON.stringify(BEREICHE)}\n`,
  "src/store/defaults.js": 'export const BOOTSTRAP_TENANT_ID = "probe";\n',
};
const NACH_TEST_UND_NACH_BAU_GRUEN = [0, 0];
const OHNE_REGELN = "Abhängigkeiten: .dependency-cruiser.cjs fehlt.";
const TEST_KOPF = ['import assert from "node:assert/strict";', 'import { test } from "node:test";', 'import { verdopple } from "../../src/rechnen.js";'];
const TEST_UEBER_EINGANG = [...TEST_KOPF, 'test("verdoppelt", () => assert.equal(verdopple(2), 4));', ""].join("\n");
const TEST_AN_INTERNEM_MODUL = [
  ...TEST_KOPF,
  'import { BOOTSTRAP_TENANT_ID } from "../../src/store/defaults.js";',
  'test("verdoppelt", () => assert.equal(verdopple(2), 4, BOOTSTRAP_TENANT_ID));',
  "",
].join("\n");
const TEXT_AM_SPEICHER = [
  'export { BOOTSTRAP_TENANT_ID } from "./store/defaults.js";',
  "",
  "export function gross(wort) {",
  "  return wort.toUpperCase();",
  "}",
  "",
].join("\n");

function verdoppeln() {
  return { ...funktion("2 !== 4"), erwarteteDateien: ["src/rechnen.js", ABNAHME], abnahme: ABNAHME };
}

function enthaeltAlles(text, teile) {
  for (const teil of teile) assert.ok(text.includes(teil), `${teil}\n---\n${text}`);
}

test("ein Test-Agent, der in einem Test ein internes Modul importiert, bekommt den Verstoß in derselben Runde zurück", (context) => {
  const drehbuch = { test: { [ABNAHME]: TEST_AN_INTERNEM_MODUL }, "test-antwort": ABSATZ_TESTIMPORTE };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: verdoppeln(), drehbuch, dateien: MIT_REGELN });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual({ abhaengigkeiten: pruefung(beleg, ABHAENGIGKEITEN), rot: pruefung(beleg, "rot") }, { abhaengigkeiten: EXIT_ROT, rot: undefined }, JSON.stringify(beleg.pruefungen));
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
  const zweiteRunde = readFileSync(join(werkzeug, "prompt-test.txt"), "utf8");
  enthaeltAlles(zweiteRunde, [
    `${ABHAENGIGKEITEN}:`,
    "Neuer Verstoß: test/rechnen/verdoppeln.test.js → src/store/defaults.js verstößt gegen „tests-nur-ueber-eingaenge“.",
    ...zweckBlock("basis/test-importe"),
    "dem Test-Agenten: basis/test-importe",
  ]);
});

test("ein Bau-Agent, der eine verbotene Abhängigkeit einführt, bekommt den Verstoß vor dem Commit zurück", (context) => {
  const { werkzeug, lauf, beleg, basis, kopf } = starte(context, { auftrag: UMBAU, drehbuch: { bau: { "src/text.js": TEXT_AM_SPEICHER }, "bau-antwort": ABSATZ_REGELN }, dateien: MIT_REGELN });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(kopf, basis);
  const ergebnis = { abhaengigkeiten: pruefung(beleg, ABHAENGIGKEITEN), lint: pruefung(beleg, "lint"), commit: pruefung(beleg, "commit") };
  assert.deepEqual(ergebnis, { abhaengigkeiten: EXIT_ROT, lint: undefined, commit: undefined }, JSON.stringify(beleg.pruefungen));
  const zweiteRunde = readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8");
  enthaeltAlles(zweiteRunde, [
    `${ABHAENGIGKEITEN}:`,
    "Neuer Verstoß: src/text.js → src/store/defaults.js verstößt gegen „speicher-nur-ueber-fassade“.",
    ...zweckBlock("basis/abhaengigkeitsregeln"),
    "dem Bau-Agenten: basis/abhaengigkeitsregeln",
  ]);
});

test("ein Auftrag ohne neuen Verstoß läuft wie bisher grün", (context) => {
  const drehbuch = { test: { [ABNAHME]: TEST_UEBER_EINGANG }, bau: { "src/rechnen.js": VERDOPPELT } };
  const { lauf, beleg } = starte(context, { auftrag: verdoppeln(), drehbuch, dateien: { ...MIT_MUTATION, ...MIT_REGELN } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, ABHAENGIGKEITEN), NACH_TEST_UND_NACH_BAU_GRUEN, JSON.stringify(beleg.pruefungen));
});

test("ein Repo ohne Abhängigkeitsregeln meldet das einmal als Hinweis statt die Prüfung zu fahren", (context) => {
  const drehbuch = { test: { [ABNAHME]: TEST_UEBER_EINGANG }, bau: { "src/rechnen.js": VERDOPPELT } };
  const { lauf, beleg } = starte(context, { auftrag: verdoppeln(), drehbuch, dateien: MIT_MUTATION });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, ABHAENGIGKEITEN), [], JSON.stringify(beleg.pruefungen));
  assert.deepEqual(beleg.hinweise.filter((hinweis) => hinweis === OHNE_REGELN), [OHNE_REGELN], JSON.stringify(beleg.hinweise));
});

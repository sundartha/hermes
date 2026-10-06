import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { befundSchluessel } from "../../tools/eslint-rules/bestand.js";
import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/lint-neue-funktionen.mjs");
const PLUGIN_URL = pathToFileURL(join(REPO_ROOT, "tools/eslint-rules/index.js")).href;
const DATEI = "src/rechnen.js";
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_ABORT = 2;
const JSON_INDENT = 2;
const REGELN = {
  "no-magic-numbers": ["error", { ignore: [0, 1, -1] }],
  "hermes/keine-kommentare": ["error", { bestand: "tools/basis/kommentare.json" }],
  "hermes/namen-ohne-begruendung": "warn",
};
const ALTER_KOMMENTAR = "  // die Antwort";

function eslintKonfiguration() {
  return [
    `import hermes from ${JSON.stringify(PLUGIN_URL)};`,
    "export default [",
    `  { plugins: { hermes }, linterOptions: { noInlineConfig: true }, rules: ${JSON.stringify(REGELN)} },`,
    "];",
    "",
  ].join("\n");
}

function json(wert) {
  return `${JSON.stringify(wert, null, JSON_INDENT)}\n`;
}

function quelle(zeilen) {
  return `${zeilen.join("\n")}\n`;
}

const ALT = [
  "export function alt(wert) {",
  ALTER_KOMMENTAR,
  "  return wert * 42;",
  "}",
  "",
  "export function sauber(wert) {",
  "  return wert + 1;",
  "}",
];

function basisRepo(context, zeilen = ALT) {
  const directory = probeRepository(context, {
    "eslint.config.mjs": eslintKonfiguration(),
    "eslint-suppressions.json": json({ [DATEI]: { "no-magic-numbers": { count: 1 } } }),
    "tools/basis/kommentare.json": json({ befunde: [befundSchluessel(DATEI, " die Antwort")] }),
    [DATEI]: quelle(zeilen),
  });
  const basis = runIn(directory, "git", ["rev-parse", "HEAD"]).stdout.trim();
  return { directory, basis };
}

function nachher({ directory, basis }, zeilen) {
  writeFiles(directory, { [DATEI]: quelle(zeilen) });
  commitAll(directory, "Nachher");
  const run = runIn(directory, process.execPath, [TOOL, "--basis", basis]);
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

function ersetzt(zeilen, alt, neu) {
  return zeilen.map((zeile) => (zeile === alt ? neu : zeile));
}

test("lint-neue-funktionen: ein neuer Verstoß in einer neuen Funktion ist rot", (context) => {
  const lauf = nachher(basisRepo(context), [...ALT, "", "export function neu(wert) {", "  return wert * 7;", "}"]);
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /src\/rechnen\.js:11 no-magic-numbers: No magic number: 7/);
  assert.doesNotMatch(lauf.output, /42/);
});

test("lint-neue-funktionen: ein alter Verstoß in einer unveränderten Funktion bleibt grün", (context) => {
  const lauf = nachher(basisRepo(context), ersetzt(ALT, "  return wert + 1;", "  return wert - 1;"));
  assert.equal(lauf.status, EXIT_OK, lauf.output);
});

test("lint-neue-funktionen: ein alter Verstoß in einer geänderten Funktion ist rot, trotz eslint-suppressions.json", (context) => {
  const zeilen = ersetzt(ALT, "  return wert * 42;", "  const eingabe = wert;\n  return eingabe * 42;");
  const lauf = nachher(basisRepo(context), zeilen);
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /no-magic-numbers: No magic number: 42/);
  assert.match(lauf.output, /hermes\/keine-kommentare/);
});

test("lint-neue-funktionen: nur einen Kommentar zu entfernen oder umzuformatieren bleibt grün", (context) => {
  const ohneKommentar = ALT.filter((zeile) => zeile !== ALTER_KOMMENTAR);
  assert.equal(nachher(basisRepo(context), ohneKommentar).status, EXIT_OK);
  const umgebrochen = ersetzt(ohneKommentar, "  return wert * 42;", "  return wert *\n    42;");
  const lauf = nachher(basisRepo(context), umgebrochen);
  assert.equal(lauf.status, EXIT_OK, lauf.output);
});

test("lint-neue-funktionen: der Tausch eines alten Treffers gegen einen neuen in neuer Funktion ist rot", (context) => {
  const zeilen = [
    "const ANTWORT = 42;",
    ...ersetzt(ALT, "  return wert * 42;", "  return wert * ANTWORT;"),
    "",
    "export function neu(wert) {",
    "  return wert * 42;",
    "}",
  ];
  const lauf = nachher(basisRepo(context), zeilen);
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /src\/rechnen\.js:12 no-magic-numbers/);
});

test("lint-neue-funktionen: ein neuer Rückruf in einer alten Funktion zählt die ganze Funktion", (context) => {
  const vorher = ["export function grenze(wert) {", "  const doppelt = wert * 42;", "  return doppelt;", "}"];
  const zeilen = ersetzt(vorher, "  return doppelt;", "  return [doppelt].map((eintrag) => eintrag)[0];");
  const lauf = nachher(basisRepo(context, vorher), zeilen);
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /src\/rechnen\.js:2 no-magic-numbers: No magic number: 42/);
});

test("lint-neue-funktionen: ein Begründungsname in neuem Code ist rot, ein langer Name nur ein Hinweis", (context) => {
  const langerName = "berechneDieSummeAllerPositionenDesWarenkorbs";
  const zeilen = [...ALT, "", `export function ${langerName}(wert) {`, "  return wert;", "}"];
  const hinweis = nachher(basisRepo(context), zeilen);
  assert.equal(hinweis.status, EXIT_OK, hinweis.output);
  assert.match(hinweis.output, new RegExp(`Hinweis.*${langerName}.*${langerName.length} Zeichen`));
  const begruendung = nachher(basisRepo(context), [...ALT, "export const sonstLeer = [];"]);
  assert.equal(begruendung.status, EXIT_FINDING, begruendung.output);
  assert.match(begruendung.output, /hermes\/namen-ohne-begruendung/);
});

test("lint-neue-funktionen: ohne, mit leerer oder unbekannter Basis bricht es mit Exit 2 ab", (context) => {
  const { directory } = basisRepo(context);
  for (const args of [[], ["--basis", ""], ["--basis", "gibt-es-nicht"]]) {
    const run = runIn(directory, process.execPath, [TOOL, ...args]);
    assert.equal(run.status, EXIT_ABORT, `${args.join(" ")}: ${run.stdout}${run.stderr}`);
    assert.match(run.stderr, /Abbruch: .*--basis/);
  }
});

const WIRKUNGSLOS = ['  const _grund = "früher war es kaputt";', '  "Absicht als Zeichenkette";'];

test("lint-neue-funktionen: eine unbenutzte _-Konstante und ein freistehender Text in neuer Funktion sind rot", (context) => {
  const zeilen = [...ALT, "", "export function neu(wert) {", ...WIRKUNGSLOS, "  return wert;", "}"];
  const lauf = nachher(basisRepo(context), zeilen);
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /no-unused-vars: '_grund' is assigned a value but never used/);
  assert.match(lauf.output, /no-unused-expressions: Expected an assignment or function call/);
});

test("lint-neue-funktionen: eine unbenutzte _-Konstante und ein freistehender Text in unveränderter alter Funktion bleiben grün", (context) => {
  const vorher = [...ALT, "", "export function zweite(wert) {", ...WIRKUNGSLOS, "  return wert;", "}"];
  const zeilen = ersetzt(vorher, "  return wert + 1;", "  return wert - 1;");
  const lauf = nachher(basisRepo(context, vorher), zeilen);
  assert.equal(lauf.status, EXIT_OK, lauf.output);
});

test("lint-neue-funktionen: eine Direktive mit Text als erste Anweisung einer neuen Funktion ist rot", (context) => {
  const zeilen = [...ALT, "", "export function neu(wert) {", '  "weil das früher kaputt war";', "  return wert;", "}"];
  const lauf = nachher(basisRepo(context), zeilen);
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /src\/rechnen\.js:11 hermes\/keine-kommentare/);
});

const KOMMA_AUSDRUCK = ["  const laenge = protokoll.push(wert);", '  return (laenge, "positiv");'];

test("lint-neue-funktionen: ein Komma-Ausdruck in neuer Funktion ist rot", (context) => {
  const zeilen = [...ALT, "", "export function neu(protokoll, wert) {", ...KOMMA_AUSDRUCK, "}"];
  const lauf = nachher(basisRepo(context), zeilen);
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /src\/rechnen\.js:12 no-sequences/);
});

test("lint-neue-funktionen: ein Komma-Ausdruck in unveränderter alter Funktion bleibt grün", (context) => {
  const vorher = [...ALT, "", "export function zaehlt(protokoll, wert) {", ...KOMMA_AUSDRUCK, "}"];
  const zeilen = ersetzt(vorher, "  return wert + 1;", "  return wert - 1;");
  const lauf = nachher(basisRepo(context, vorher), zeilen);
  assert.equal(lauf.status, EXIT_OK, lauf.output);
});

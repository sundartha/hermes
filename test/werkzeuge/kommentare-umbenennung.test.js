import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { REPO_ROOT } from "./probe-repo.js";
import { nachCommitPruefen, repoMitBasis } from "./pr-probe.js";

const NEUE_KOMMENTARE = join(REPO_ROOT, "tools/neue-kommentare.mjs");
const WANDERUNG = join(REPO_ROOT, "tools/kommentar-wanderung.mjs");
const LINT = join(REPO_ROOT, "tools/lint-neue-funktionen.mjs");
const PLUGIN_URL = pathToFileURL(join(REPO_ROOT, "tools/eslint-rules/index.js")).href;
const TS_URL = pathToFileURL(join(REPO_ROOT, "node_modules/typescript-eslint/dist/index.js")).href;
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const REGELN = {
  "no-magic-numbers": ["error", { ignore: [0, 1, -1] }],
  "hermes/keine-kommentare": "error",
};
const KONFIGURATION = [
  `import hermes from ${JSON.stringify(PLUGIN_URL)};`,
  `import tseslint from ${JSON.stringify(TS_URL)};`,
  "export default [",
  `  { plugins: { hermes }, rules: ${JSON.stringify(REGELN)} },`,
  '  { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },',
  "];",
  "",
].join("\n");
const SATZ = "Der Abruf wartet höchstens zehn Sekunden auf die Antwort des Anbieters";

function quelle(zeilen) {
  return `${zeilen.join("\n")}\n`;
}

const ALT = quelle([
  "export function alt(wert) {",
  "  // die Antwort",
  "  return wert * 42;",
  "}",
  "",
  "export function sauber(wert) {",
  "  return wert + 1;",
  "}",
]);

function basisRepo(context, dateien) {
  return repoMitBasis(context, { "eslint.config.mjs": KONFIGURATION, ...dateien });
}

function umbenannt(context, { vorher, nachher, werkzeug }) {
  const repo = basisRepo(context, { "src/rechnen.js": vorher });
  rmSync(join(repo.directory, "src/rechnen.js"));
  return nachCommitPruefen(repo, werkzeug, { "src/rechnen.ts": nachher });
}

test("kommentare-umbenennung: ein neuer Kommentar in einer neuen .ts-Datei ist rot", (context) => {
  const lauf = nachCommitPruefen(basisRepo(context, {}), NEUE_KOMMENTARE, {
    "src/neu.ts": quelle(["// neue Begründung", "export const wert: number = 1;"]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /src\/neu\.ts:1 neuer Kommentar/);
});

test("kommentare-umbenennung: eine Umbenennung nur mit Typen meldet den alten Kommentar nicht als neu", (context) => {
  const lauf = umbenannt(context, {
    vorher: ALT,
    nachher: ALT.replace("sauber(wert)", "sauber(wert: number): number"),
    werkzeug: NEUE_KOMMENTARE,
  });
  assert.equal(lauf.status, EXIT_OK, lauf.output);
});

test("kommentare-umbenennung: eine Umbenennung nur mit Typen und einem neuen Kommentar ist rot", (context) => {
  const lauf = umbenannt(context, {
    vorher: ALT,
    nachher: ALT.replace("sauber(wert) {", "sauber(wert: number): number {\n  // neu"),
    werkzeug: NEUE_KOMMENTARE,
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /src\/rechnen\.ts:7 neuer Kommentar/);
  assert.doesNotMatch(lauf.output, /src\/rechnen\.ts:2 /);
});

test("kommentare-umbenennung: eine Umbenennung mit geänderter Rechnung zählt den alten Kommentar wie in einer neuen Datei", (context) => {
  const lauf = umbenannt(context, {
    vorher: ALT,
    nachher: ALT.replace("wert + 1", "wert + 2"),
    werkzeug: NEUE_KOMMENTARE,
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /src\/rechnen\.ts:2 neuer Kommentar/);
});

test("kommentare-umbenennung: ein Kommentar, der in eine Zeichenkette einer neuen .ts-Datei wandert, ist rot", (context) => {
  const repo = basisRepo(context, {
    "src/abruf.js": quelle([`// ${SATZ}`, "export const wert = 1;"]),
  });
  const lauf = nachCommitPruefen(repo, WANDERUNG, {
    "src/abruf.js": quelle(["export const wert = 1;"]),
    "src/hinweis.ts": quelle([`export const HINWEIS: string = ${JSON.stringify(SATZ)};`]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(
    lauf.output,
    /Kommentar aus src\/abruf\.js:1 taucht in src\/hinweis\.ts:1 wieder auf/,
  );
});

const MIT_HINWEIS = quelle([`// ${SATZ}`, `export const HINWEIS = ${JSON.stringify(SATZ)};`]);

test("kommentare-umbenennung: eine Umbenennung nur mit Typen lässt Kommentar und gleichlautende Zeichenkette stehen", (context) => {
  const lauf = umbenannt(context, {
    vorher: MIT_HINWEIS,
    nachher: MIT_HINWEIS.replace("HINWEIS =", "HINWEIS: string ="),
    werkzeug: WANDERUNG,
  });
  assert.equal(lauf.status, EXIT_OK, lauf.output);
  assert.match(lauf.output, /0 entfernte Kommentare/);
});

test("kommentare-umbenennung: eine Umbenennung, die einen Kommentar zur Zeichenkette macht, ist rot", (context) => {
  const lauf = umbenannt(context, {
    vorher: quelle([`// ${SATZ}`, "export const HINWEIS = '';"]),
    nachher: quelle([`export const HINWEIS: string = ${JSON.stringify(SATZ)};`]),
    werkzeug: WANDERUNG,
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(
    lauf.output,
    /Kommentar aus src\/rechnen\.js:1 taucht in src\/rechnen\.ts:1 wieder auf/,
  );
});

test("kommentare-umbenennung: ein Kommentar in einer Typangabe, der in eine Zeichenkette wandert, ist rot", (context) => {
  const repo = basisRepo(context, {
    "src/abruf.ts": quelle([
      `export function warte(sekunden: /* ${SATZ} */ number): number {`,
      "  return sekunden;",
      "}",
    ]),
  });
  const lauf = nachCommitPruefen(repo, WANDERUNG, {
    "src/abruf.ts": quelle([
      "export function warte(sekunden: number): number {",
      "  return sekunden;",
      "}",
      `export const HINWEIS: string = ${JSON.stringify(SATZ)};`,
    ]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /Kommentar aus src\/abruf\.ts:1 taucht in src\/abruf\.ts:4 wieder auf/);
});

test("kommentare-umbenennung: eine neue Funktion in einer .ts-Datei wird ohne Bestand gelintet", (context) => {
  const lauf = nachCommitPruefen(basisRepo(context, {}), LINT, {
    "src/neu.ts": quelle([
      "export function neu(wert: number): number {",
      "  return wert * 42;",
      "}",
    ]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /src\/neu\.ts:2 no-magic-numbers/);
});

test("kommentare-umbenennung: nach einer Umbenennung nur mit Typen zählen Altbefunde unveränderter Funktionen nicht", (context) => {
  const lauf = umbenannt(context, {
    vorher: ALT,
    nachher: ALT.replace("sauber(wert)", "sauber(wert: number): number"),
    werkzeug: LINT,
  });
  assert.equal(lauf.status, EXIT_OK, lauf.output);
});

test("kommentare-umbenennung: eine Funktion, die bei der Umbenennung nur Typen bekommt, behält ihren Altbefund", (context) => {
  const lauf = umbenannt(context, {
    vorher: ALT,
    nachher: ALT.replace("alt(wert)", "alt(wert: number): number"),
    werkzeug: LINT,
  });
  assert.equal(lauf.status, EXIT_OK, lauf.output);
});

test("kommentare-umbenennung: eine Funktion, die bei der Umbenennung Typen und Klammern bekommt, gilt als geändert", (context) => {
  const lauf = umbenannt(context, {
    vorher: ALT,
    nachher: ALT.replace("alt(wert)", "alt(wert: number): number").replace(
      "wert * 42;",
      "(wert * 42);",
    ),
    werkzeug: LINT,
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /src\/rechnen\.ts:3 no-magic-numbers/);
});

test("kommentare-umbenennung: nach einer Umbenennung mit geänderter Rechnung zählt jede Funktion als neu", (context) => {
  const lauf = umbenannt(context, {
    vorher: ALT,
    nachher: ALT.replace("wert + 1", "wert + 2"),
    werkzeug: LINT,
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /src\/rechnen\.ts:3 no-magic-numbers/);
});

test("kommentare-umbenennung: eine geänderte .ts-Datei, die ESLint nicht lesen kann, ist rot", (context) => {
  const ohneProjekt = KONFIGURATION.replace(
    "parser: tseslint.parser",
    "parser: tseslint.parser, parserOptions: { projectService: true }",
  );
  const repo = repoMitBasis(context, { "eslint.config.mjs": ohneProjekt });
  const lauf = nachCommitPruefen(repo, LINT, {
    "src/neu.ts": quelle(["export function neu(wert: number): number {", "  return wert;", "}"]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /src\/neu\.ts:\S+ Parser: Parsing error/);
});

test("kommentare-umbenennung: eine Umbenennung nur mit Typen, die einen Kommentar zum Literaltyp macht, ist rot", (context) => {
  const lauf = umbenannt(context, {
    vorher: quelle([`// ${SATZ}`, "export const HINWEIS = '';"]),
    nachher: quelle([
      `type Grund = ${JSON.stringify(SATZ)};`,
      "export const HINWEIS: Grund | '' = '';",
    ]),
    werkzeug: WANDERUNG,
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(
    lauf.output,
    /Kommentar aus src\/rechnen\.js:1 taucht in src\/rechnen\.ts:1 wieder auf/,
  );
});

import assert from "node:assert/strict";
import { readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  EXIT_GRUEN,
  TOR,
  UNTERDRUECKUNGEN,
  VORAB_HAKEN,
  istGruen,
  istRot,
} from "./unterdrueckungen-probe.js";
import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const ALTLAST = "eslint-legacy-exceptions.json";
const MITGENOMMEN = [
  TOR,
  VORAB_HAKEN,
  "tools/umbenennung.mjs",
  "tools/syntaxbaum.mjs",
  "tools/eslint-rules/knoten.js",
];
const ALT = "src/zahl.js";
const NEU = "src/zahl.ts";
const VAR_BEFUND = "no-var :: Unexpected var, use let or const instead.";
const ESLINT_KONFIG = [
  'import tseslint from "typescript-eslint";',
  "",
  "export default [",
  '  { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },',
  '  { files: ["**/*.{js,cjs,ts}"], rules: { "no-var": "error", "no-warning-comments": "error" } },',
  "];",
  "",
].join("\n");
const GEMEINSAME_ZEILEN = 20;
const STUFEN = Array.from({ length: GEMEINSAME_ZEILEN }, (_wert, stufe) => `  "stufe-${stufe}",`);
const JS = [
  "var grenze = 10;",
  "",
  "export function klein(zahl) {",
  "  return zahl < grenze;",
  "}",
  "",
  "export const stufen = [",
  ...STUFEN,
  "];",
  "",
].join("\n");
const TS = JS.replace("var grenze = 10;", "var grenze: number = 10;").replace(
  "klein(zahl)",
  "klein(zahl: number): boolean",
);
const TS_GEAENDERT = TS.replace("zahl < grenze", "zahl <= grenze");

function unterdrueckt(datei, anzahl, weitere = {}) {
  return { [datei]: { "no-var": { count: anzahl } }, ...weitere };
}

function altlast(datei, anzahl, weitere = {}) {
  return {
    [datei]: { reason: "Altlast", date: "2026-01-01", findings: { [VAR_BEFUND]: anzahl } },
    ...weitere,
  };
}

function listen(suppressions, legacy) {
  return {
    [UNTERDRUECKUNGEN]: `${JSON.stringify(suppressions)}\n`,
    [ALTLAST]: `${JSON.stringify(legacy)}\n`,
  };
}

function basisRepo(context) {
  const mitgenommen = Object.fromEntries(
    MITGENOMMEN.map((pfad) => [pfad, readFileSync(join(REPO_ROOT, pfad), "utf8")]),
  );
  const repo = probeRepository(context, {
    ...mitgenommen,
    ".gitignore": "node_modules\n",
    "package.json": `${JSON.stringify({ type: "module", scripts: { lint: "true" } })}\n`,
    "eslint.config.js": ESLINT_KONFIG,
    "eslint-suppressions.empty.json": "{}\n",
    [ALT]: JS,
    ...listen(unterdrueckt(ALT, 1), altlast(ALT, 1)),
  });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(repo, "node_modules"));
  return repo;
}

function umbenannt(context, inhalt, listenNachher) {
  const repo = basisRepo(context);
  rmSync(join(repo, ALT));
  writeFiles(repo, { [NEU]: inhalt, ...listenNachher });
  return repo;
}

function git(repo, ...argumente) {
  const lauf = runIn(repo, "git", argumente);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
}

function lauf(repo, befehl, argumente) {
  const ergebnis = runIn(repo, befehl, argumente);
  return { status: ergebnis.status, ausgabe: `${ergebnis.stdout}${ergebnis.stderr}` };
}

function ciWeg(context, inhalt, listenNachher) {
  const repo = umbenannt(context, inhalt, listenNachher);
  commitAll(repo, "Umbenennung");
  return lauf(repo, process.execPath, [TOR, "--basis", "HEAD~1"]);
}

const VERSCHOBEN = listen(unterdrueckt(NEU, 1), altlast(NEU, 1));
const NUR_UNTERDRUECKT = listen(unterdrueckt(NEU, 1), {});

test("CI-Weg: Umbenennung nur mit Typen, Einträge beider Listen verschoben, gleiche Zahl ist grün", (context) => {
  const ergebnis = ciWeg(context, TS, VERSCHOBEN);
  istGruen(ergebnis);
});

test("CI-Weg: Umbenennung nur mit Typen, verschobener Eintrag mit einer Zahl oder Regel mehr ist rot", (context) => {
  const hoeher = ciWeg(context, TS, listen(unterdrueckt(NEU, 2), altlast(NEU, 1)));
  istRot(hoeher);
  assert.match(hoeher.ausgabe, /src\/zahl\.ts \(umbenannt aus src\/zahl\.js\) -> no-var: 1 -> 2/);
  const regel = ciWeg(context, TS, {
    ...VERSCHOBEN,
    [UNTERDRUECKUNGEN]: `${JSON.stringify({ [NEU]: { "no-var": { count: 1 }, complexity: { count: 1 } } })}\n`,
  });
  istRot(regel);
  assert.match(
    regel.ausgabe,
    /src\/zahl\.ts \(umbenannt aus src\/zahl\.js\) -> complexity: 0 -> 1/,
  );
  const pin = ciWeg(context, TS, listen(unterdrueckt(NEU, 1), altlast(NEU, 2)));
  istRot(pin);
  assert.match(pin.ausgabe, /in eslint-legacy-exceptions\.json steigen Zahlen/);
});

test("CI-Weg: alte und neue Seite zählen zusammen, wenn beide Einträge bleiben", (context) => {
  const beide = ciWeg(
    context,
    TS,
    listen(unterdrueckt(NEU, 1, unterdrueckt(ALT, 1)), altlast(NEU, 1, altlast(ALT, 1))),
  );
  istRot(beide);
  assert.match(beide.ausgabe, /src\/zahl\.ts \(umbenannt aus src\/zahl\.js\) -> no-var: 1 -> 2/);
  assert.match(
    beide.ausgabe,
    /src\/zahl\.ts \(umbenannt aus src\/zahl\.js\) -> Altlast-Eintrag: 1 -> 2/,
  );
});

test("CI-Weg: Umbenennung mit Verhaltensänderung und verschobenen Einträgen ist rot wie ein neuer Eintrag", (context) => {
  const ergebnis = ciWeg(context, TS_GEAENDERT, VERSCHOBEN);
  istRot(ergebnis);
  assert.match(ergebnis.ausgabe, /^ {2}src\/zahl\.ts -> no-var: 0 -> 1$/m);
  assert.match(ergebnis.ausgabe, /^ {2}src\/zahl\.ts -> Altlast-Eintrag: 0 -> 1$/m);
});

test("CI-Weg: eine neue .ts-Datei ohne Paar ist so streng wie eine neue .js-Datei", (context) => {
  const repo = basisRepo(context);
  writeFiles(repo, {
    [NEU]: TS,
    ...listen(unterdrueckt(ALT, 1, unterdrueckt(NEU, 1)), altlast(ALT, 1)),
  });
  commitAll(repo, "daneben");
  const ergebnis = lauf(repo, process.execPath, [TOR, "--basis", "HEAD~1"]);
  istRot(ergebnis);
  assert.match(ergebnis.ausgabe, /^ {2}src\/zahl\.ts -> no-var: 0 -> 1$/m);
});

test("pre-commit-Weg: zählt die vorgemerkte Umbenennung und lintet vorher die alte Datei; eine nicht vorgemerkte Löschung ergibt kein Paar", (context) => {
  const nichtVorgemerkt = umbenannt(context, TS, VERSCHOBEN);
  git(nichtVorgemerkt, "add", UNTERDRUECKUNGEN, ALTLAST);
  const rot = lauf(nichtVorgemerkt, process.execPath, [TOR]);
  istRot(rot);
  assert.match(rot.ausgabe, /^ {2}src\/zahl\.ts -> no-var: 0 -> 1$/m);
  const nurNeueVorgemerkt = umbenannt(context, TS, VERSCHOBEN);
  git(nurNeueVorgemerkt, "add", NEU, UNTERDRUECKUNGEN, ALTLAST);
  const ohnePaar = lauf(nurNeueVorgemerkt, process.execPath, [TOR]);
  istRot(ohnePaar);
  const vorgemerkt = umbenannt(context, TS, NUR_UNTERDRUECKT);
  git(vorgemerkt, "add", "-A");
  const gruen = lauf(vorgemerkt, process.execPath, [TOR, NEU]);
  istGruen(gruen);
});

test("pre-commit-Haken: eine per git mv umbenannte .ts-Datei wird geprüft, ein neuer Befund ist rot", (context) => {
  const repo = basisRepo(context);
  git(repo, "mv", ALT, NEU);
  writeFiles(repo, { [NEU]: `// TODO: pruefen\n${TS}`, ...NUR_UNTERDRUECKT });
  git(repo, "add", "-A");
  const ergebnis = lauf(repo, "sh", [VORAB_HAKEN]);
  istRot(ergebnis);
  assert.match(ergebnis.ausgabe, /src\/zahl\.ts -> no-var: 1/);
  assert.match(ergebnis.ausgabe, /Befunde bewegt: 0 -> 1 {2}no-warning-comments/);
});

test("pre-commit-Haken: eine vorgemerkte .cjs-Datei mit Eintrag wird geprüft, ein neuer Befund ist rot", (context) => {
  const cjs = "src/grenze.cjs";
  const inhalt = "var grenze = 10;\nmodule.exports = { grenze };\n";
  const repo = basisRepo(context);
  writeFiles(repo, { [cjs]: inhalt, ...listen(unterdrueckt(ALT, 1, unterdrueckt(cjs, 1)), {}) });
  commitAll(repo, "cjs");
  writeFiles(repo, { [cjs]: `// TODO: pruefen\n${inhalt}` });
  git(repo, "add", "-A");
  const ergebnis = lauf(repo, "sh", [VORAB_HAKEN]);
  istRot(ergebnis);
  assert.match(ergebnis.ausgabe, /src\/grenze\.cjs -> no-var: 1/);
});

import assert from "node:assert/strict";
import { existsSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

import { altfunktionBefunde } from "../../tools/ziele/sorten.mjs";
import { REPO_ROOT, probeDirectory, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const PROBE = [
  "export function aussen(wert) {",
  "  var doppelt = wert * 2;",
  "  return [1].map(() => {",
  "    var innen = doppelt;",
  "    return innen;",
  "  });",
  "}",
  "const objekt = {",
  "  methode(links, rechts) {",
  "    return links + rechts;",
  "  },",
  "  pfeil: () => 1,",
  "};",
  "export const sauber = () => objekt;",
  "",
].join("\n");

function probe(context) {
  const ordner = probeRepository(context, {
    ".gitignore": "node_modules\n",
    "package.json": JSON.stringify({ type: "module" }),
    "eslint.config.js": 'export default [{ rules: { "no-var": "error", "max-params": ["error", { max: 1 }], "no-unused-vars": "warn" } }];\n',
    "eslint-suppressions.json": JSON.stringify({ "src/probe.js": { "no-var": { count: 2 }, "max-params": { count: 1 } } }),
    "src/probe.js": PROBE,
  });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(ordner, "node_modules"));
  return ordner;
}

function karte(ordner, ...argumente) {
  return runIn(ordner, process.execPath, [EINSTIEG, "karte", ...argumente]);
}

const ERWARTET = [
  { name: "aussen", von: 1, bis: 7, zeilen: 7, befunde: { "no-var": 1 } },
  { name: "anonym ab Zeile 3", von: 3, bis: 6, zeilen: 4, befunde: { "no-var": 1 } },
  { name: "methode", von: 9, bis: 11, zeilen: 3, befunde: { "max-params": 1 } },
  { name: "pfeil", von: 12, bis: 12, zeilen: 1, befunde: {} },
  { name: "sauber", von: 14, bis: 14, zeilen: 1, befunde: {} },
];

test("karte nennt je Funktion Name, Zeilen, Größe und Befunde je Regel, ohne die Ausnahmen", (context) => {
  const ordner = probe(context);
  const lauf = karte(ordner, "src/probe.js", "--json");
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.deepEqual(JSON.parse(lauf.stdout), { datei: "src/probe.js", funktionen: ERWARTET });
  assert.equal(runIn(ordner, "git", ["status", "--porcelain"]).stdout, "");
});

test("karte ohne --json schreibt eine Zeile je Funktion", (context) => {
  const ordner = probe(context);
  const lauf = karte(ordner, "src/probe.js");
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.deepEqual(lauf.stdout.trimEnd().split("\n"), [
    "src/probe.js",
    "aussen\t1-7\t7 Zeilen\tno-var 1",
    "anonym ab Zeile 3\t3-6\t4 Zeilen\tno-var 1",
    "methode\t9-11\t3 Zeilen\tmax-params 1",
    "pfeil\t12-12\t1 Zeilen\tkeine Befunde",
    "sauber\t14-14\t1 Zeilen\tkeine Befunde",
  ]);
  assert.equal(runIn(ordner, "git", ["status", "--porcelain"]).stdout, "");
});

test("karte nimmt auch einen absoluten Pfad, und --json gilt nur für karte und messung", (context) => {
  const ordner = probe(context);
  const lauf = karte(ordner, join(ordner, "src/probe.js"), "--json");
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.deepEqual(JSON.parse(lauf.stdout), { datei: "src/probe.js", funktionen: ERWARTET });
  assert.equal(runIn(ordner, process.execPath, [EINSTIEG, "pruefe", "phase.json", "--json"]).status, 2);
});

test("karte bricht ab, wenn ESLint die Datei ignoriert oder nicht lesen kann", (context) => {
  const ordner = probeRepository(context, {
    ".gitignore": "node_modules\n",
    "eslint.config.js": 'export default [{ ignores: ["src/ignoriert.js"] }, { rules: { "no-var": "error" } }];\n',
    "src/ignoriert.js": "var x = 1;\nexport function f() {\n  return x;\n}\n",
    "src/kaputt.js": "export function f( {\n",
  });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(ordner, "node_modules"));
  for (const datei of ["src/ignoriert.js", "src/kaputt.js"]) {
    const lauf = karte(ordner, datei);
    assert.equal(lauf.status, 1, `${datei}: ${lauf.stdout}`);
    assert.match(lauf.stderr, new RegExp(`Abbruch: ESLint konnte ${datei} nicht prüfen: `));
  }
});

test("karte bricht ab, wenn die Datei fehlt oder ESLint kein Ergebnis liefert", (context) => {
  const ordner = probe(context);
  const fehlt = karte(ordner, "src/gibt-es-nicht.js");
  assert.equal(fehlt.status, 1);
  assert.match(fehlt.stderr, /Abbruch: Datei fehlt: src\/gibt-es-nicht\.js/);
  const kaputt = probeRepository(context, { "eslint.config.js": "export default [{ rules: { unbekannt: 'error' } }];\n", "src/probe.js": PROBE });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(kaputt, "node_modules"));
  const ohneErgebnis = karte(kaputt, "src/probe.js");
  assert.equal(ohneErgebnis.status, 1);
  assert.match(ohneErgebnis.stderr, /Abbruch: ESLint lieferte kein Ergebnis für src\/probe\.js/);
});

function melder(ordner) {
  const marke = join(ordner, "ausgefuehrt.txt");
  const konfiguration = `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marke)}, "ja");\nexport default [];\n`;
  return { marke, konfiguration };
}

test("karte führt keine ESLint-Konfiguration aus dem Ordner der angegebenen Datei im Repo aus", (context) => {
  const ordner = probe(context);
  const { marke, konfiguration } = melder(probeDirectory(context, {}));
  writeFiles(ordner, { "fremd/eslint.config.js": konfiguration, "fremd/x.js": "export const a = 1;\n" });
  const lauf = karte(ordner, "fremd/x.js");
  assert.equal(existsSync(marke), false, "karte hat Code aus einer fremden eslint.config.js ausgeführt");
  assert.equal(lauf.status, 0, lauf.stderr);
});

test("karte führt keine ESLint-Konfiguration aus einem Ordner außerhalb des Repos aus", (context) => {
  const ordner = probe(context);
  const fremd = probeDirectory(context, { "x.js": "export const a = 1;\n" });
  const { marke, konfiguration } = melder(fremd);
  writeFiles(fremd, { "eslint.config.js": konfiguration });
  const lauf = karte(ordner, join(fremd, "x.js"));
  assert.equal(existsSync(marke), false, "karte hat Code aus einer fremden eslint.config.js ausgeführt");
  assert.equal(lauf.status, 1);
  assert.match(lauf.stderr, /Abbruch: .*x\.js liegt nicht im Repo/);
});

test("karte lehnt Pfade ab, die über .., einen Symlink oder einen absoluten Pfad aus dem Repo führen", (context) => {
  const ordner = probe(context);
  const fremd = probeDirectory(context, { "x.js": "export const a = 1;\n" });
  symlinkSync(fremd, join(ordner, "verweis"));
  for (const datei of [join(relative(ordner, fremd), "x.js"), "verweis/x.js", join(fremd, "x.js"), "src/../src/probe.js"]) {
    const lauf = karte(ordner, datei);
    assert.equal(lauf.status, 1, datei);
    assert.equal(lauf.stdout, "", datei);
    assert.match(lauf.stderr, /liegt nicht im Repo/, datei);
  }
});

test("karte lehnt Dateien ab, die Git ignoriert, und nimmt neue, noch nicht versionierte Dateien an", (context) => {
  const ordner = probe(context);
  writeFiles(ordner, { ".git/info/exclude": "lokal/\n", "lokal/x.js": "export const a = 1;\n", "pakete/node_modules/x.js": "export const a = 1;\n", "src/neu.js": "export const neu = () => 1;\n" });
  for (const datei of ["pakete/node_modules/x.js", "lokal/x.js"]) {
    const lauf = karte(ordner, datei);
    assert.equal(lauf.status, 1, datei);
    assert.equal(lauf.stdout, "", datei);
    assert.match(lauf.stderr, /die Git ignoriert/, datei);
  }
  const neu = karte(ordner, "src/neu.js");
  assert.equal(neu.status, 0, neu.stderr);
  assert.equal(neu.stdout, "src/neu.js\nneu\t1-1\t1 Zeilen\tkeine Befunde\n");
});

test("karte und die Wahl der Altfunktionen nennen eine Datei hinter einem Symlink im Repo unter demselben Pfad", (context) => {
  const ordner = probe(context);
  symlinkSync("probe.js", join(ordner, "src/verweis.js"));
  writeFiles(ordner, { "eslint-suppressions.json": JSON.stringify({ "src/probe.js": { "no-var": { count: 2 } }, "src/verweis.js": { "no-var": { count: 2 } } }) });
  const lauf = karte(ordner, "src/verweis.js", "--json");
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.deepEqual([...altfunktionBefunde(ordner).keys()], [JSON.parse(lauf.stdout).datei]);
});

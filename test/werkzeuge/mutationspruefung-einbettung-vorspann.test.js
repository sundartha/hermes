import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { einbettungsImport } from "../../tools/mutationspruefung/einbettung.mjs";
import { EINBETTUNG_VORSPANN } from "../../tools/mutationspruefung/zustand.mjs";
import { probeDirectory } from "./probe-repo.js";

const ZUSTAND = new URL("../../tools/mutationspruefung/zustand.mjs", import.meta.url).href;
const AKTIVER_MUTANT = "__STRYKER_ACTIVE_MUTANT__";
const ORIGINAL = ["export function f(x) {", "  return x + 1;", "}", "function g(x) {", "  return x * 2;", "}", ""].join("\n");
const AUSGABE = "process.stdout.write(JSON.stringify({ f: f.toString(), g: g.toString(), abdeckung: globalThis.__stryker__?.mutantCoverage, gewoehnlich: [function gewoehnlich() { return 1; }, (zahl) => zahl, class Klasse {}, Math.max].map(String), vorspann: process.env.MUTATIONSPRUEFUNG_EINBETTUNG_VORSPANN }));";
const KIND = [
  "function f(x) {",
  '  if (stryMutAct_9fa48("7")) {',
  "    {}",
  "  } else {",
  '    stryCov_9fa48("7");',
  '    return stryMutAct_9fa48("8") ? x - 1 : (stryCov_9fa48("8"), x + 1);',
  "  }",
  "}",
  "function g(x) {",
  '  return stryMutAct_9fa48("10") ? x / 2 : (stryCov_9fa48("10"), x * 2);',
  "}",
  AUSGABE,
  "",
].join("\n");
const ENKEL = [
  'import { spawnSync } from "node:child_process";',
  `import { mitAktivemMutanten } from ${JSON.stringify(ZUSTAND)};`,
  'const kind = spawnSync(process.execPath, ["kind.mjs"], { encoding: "utf8", env: mitAktivemMutanten({ PATH: process.env.PATH }) });',
  "process.stdout.write(kind.stdout);",
  "process.stderr.write(kind.stderr);",
  "process.exitCode = kind.status;",
  "",
].join("\n");
const UMGEBUNG = [
  `import { mitAktivemMutanten } from ${JSON.stringify(ZUSTAND)};`,
  'process.stdout.write(JSON.stringify(mitAktivemMutanten({ PATH: "pfad" })));',
  "",
].join("\n");

function vorspannUrl(quelle) {
  return einbettungsImport(quelle).replace("--import=", "");
}

function ordner(context, quellcode = ORIGINAL) {
  const wurzel = probeDirectory(context, {
    "mit leerzeichen/original.js": quellcode,
    "mit leerzeichen/kind.mjs": KIND,
    "mit leerzeichen/enkel.mjs": ENKEL,
    "mit leerzeichen/umgebung.mjs": UMGEBUNG,
  });
  const arbeit = join(wurzel, "mit leerzeichen");
  return { arbeit, quelle: join(arbeit, "original.js") };
}

function starte({ arbeit, skript, flags = [], umgebung = {} }) {
  return spawnSync(process.execPath, [...flags, skript], {
    cwd: arbeit,
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...umgebung },
  });
}

function ausgabe(lauf) {
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  return JSON.parse(lauf.stdout);
}

test("Der Vorspann liefert im Kindprozess ohne aktiven Mutanten den Originaltext, meldet die Mutanten der Funktionen als statisch abgedeckt und macht die Quelle für weitere Kindprozesse sichtbar", (context) => {
  const { arbeit, quelle } = ordner(context);
  const erg = ausgabe(starte({ arbeit, skript: "kind.mjs", flags: [einbettungsImport(quelle)] }));
  assert.equal(erg.f, "function f(x) {\n  return x + 1;\n}");
  assert.equal(erg.g, "function g(x) {\n  return x * 2;\n}");
  assert.deepEqual(erg.abdeckung, { static: { 7: 1, 8: 1, 10: 1 }, perTest: {} });
  assert.equal(erg.vorspann, vorspannUrl(quelle));
  assert.deepEqual(erg.gewoehnlich, ["function gewoehnlich() { return 1; }", "(zahl) => zahl", "class Klasse {}", "function max() { [native code] }"]);
});

test("Der Vorspann liefert für die Funktion mit dem aktiven Mutanten die wirksame Fassung und für die anderen den Originaltext", (context) => {
  const { arbeit, quelle } = ordner(context);
  const erg = ausgabe(starte({ arbeit, skript: "kind.mjs", flags: [einbettungsImport(quelle)], umgebung: { [AKTIVER_MUTANT]: "8" } }));
  assert.equal(runInNewContext(`${erg.f};\nf(5)`), 4);
  assert.equal(erg.g, "function g(x) {\n  return x * 2;\n}");
});

test("Ein Kindprozess, den ein Test mit mitAktivemMutanten startet, lädt den Vorspann mit derselben Quelle und sieht denselben aktiven Mutanten, auch bei Leerzeichen im Pfad", (context) => {
  const { arbeit, quelle } = ordner(context);
  const lauf = starte({ arbeit, skript: "enkel.mjs", flags: [einbettungsImport(quelle)], umgebung: { [AKTIVER_MUTANT]: "10" } });
  const erg = ausgabe(lauf);
  assert.equal(runInNewContext(`${erg.g};\ng(8)`), 4);
  assert.equal(erg.f, "function f(x) {\n  return x + 1;\n}");
  assert.equal(erg.vorspann, vorspannUrl(quelle));
});

test("Ohne Vorspann im Prozess ergänzt mitAktivemMutanten die Umgebung eines Kindes nicht, mit Vorspann trägt sie genau diesen Vorspann in NODE_OPTIONS ein, auch bei Leerzeichen im Pfad", (context) => {
  const { arbeit, quelle } = ordner(context);
  const ohne = ausgabe(starte({ arbeit, skript: "umgebung.mjs" }));
  assert.deepEqual(ohne, { PATH: "pfad" });
  const mit = ausgabe(starte({ arbeit, skript: "umgebung.mjs", umgebung: { [EINBETTUNG_VORSPANN]: vorspannUrl(quelle) } }));
  assert.deepEqual(mit, { PATH: "pfad", NODE_OPTIONS: einbettungsImport(quelle) });
  assert.doesNotMatch(mit.NODE_OPTIONS, /\s/);
  const abfrage = mit.NODE_OPTIONS.split("?").at(-1);
  assert.equal(new URLSearchParams(abfrage).get("quelle"), quelle);
});

test("Der Vorspann bricht laut ab, wenn ihm die Quelle fehlt, wenn der Name der Funktion in der Quelle mehrdeutig ist oder keine Deklaration trägt", (context) => {
  const ohneQuelle = ordner(context);
  const vorspann = einbettungsImport(ohneQuelle.quelle).replace(/\?.*$/, "");
  const fehlt = starte({ arbeit: ohneQuelle.arbeit, skript: "kind.mjs", flags: [vorspann] });
  assert.notEqual(fehlt.status, 0);
  assert.match(fehlt.stderr, /Einbettung: dem Vorspann fehlt die Quelldatei/);

  const doppelt = ordner(context, `${ORIGINAL}function h() {\n  function f() {}\n}\n`);
  const mehrdeutig = starte({ arbeit: doppelt.arbeit, skript: "kind.mjs", flags: [einbettungsImport(doppelt.quelle)] });
  assert.notEqual(mehrdeutig.status, 0);
  assert.match(mehrdeutig.stderr, /Einbettung: f ist in .*original\.js mehrdeutig/);

  const leer = ordner(context, "export const f = (x) => x;\n");
  const ohneDeklaration = starte({ arbeit: leer.arbeit, skript: "kind.mjs", flags: [einbettungsImport(leer.quelle)] });
  assert.notEqual(ohneDeklaration.status, 0);
  assert.match(ohneDeklaration.stderr, /Einbettung: f ist in .*original\.js keine Funktionsdeklaration/);
});

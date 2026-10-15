import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/typabdeckung.mjs");
const FLOOR_FILE = "tools/basis/typabdeckung.json";
const EXIT_GREEN = 0;
const EXIT_RED = 1;
const FULL_FLOOR = 100;
const LOWER_FLOOR = 90;
const PASSING_FLOOR = 85;

const TSCONFIG = {
  compilerOptions: {
    target: "es2024",
    lib: ["es2024"],
    module: "nodenext",
    moduleResolution: "nodenext",
    types: [],
    noEmit: true,
    strict: true,
    allowJs: true,
    checkJs: false,
  },
  include: ["src", "test", "tools", "scripts"],
};

function floor(value) {
  return `${JSON.stringify({ mindestens: value })}\n`;
}

const BASE_FILES = {
  "package.json": `${JSON.stringify({ type: "module" })}\n`,
  "tsconfig.json": `${JSON.stringify(TSCONFIG)}\n`,
  [FLOOR_FILE]: floor(FULL_FLOOR),
  "src/alt.js": "export function roh(wert) {\n  return wert;\n}\n",
};

function coverage(context, files, args = []) {
  const repo = probeRepository(context, { ...BASE_FILES, ...files });
  const run = runIn(repo, process.execPath, [TOOL, ...args]);
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

test("typabdeckung: ohne TypeScript-Datei gilt die Abdeckung als voll und endet grün", (context) => {
  const result = coverage(context, {});
  assert.equal(result.status, EXIT_GREEN, result.output);
  assert.match(result.output, /in 0 TypeScript-Dateien \(100\.00 %\)/);
});

test("typabdeckung: vollständig typisierte .ts-Datei mit as const endet grün", (context) => {
  const result = coverage(context, {
    "src/neu.ts": [
      "export function verdoppelt(zahl: number): number {",
      "  return zahl * 2;",
      "}",
      "export const arten = { eingehend: 1 } as const;",
      "",
    ].join("\n"),
  });
  assert.equal(result.status, EXIT_GREEN, result.output);
  assert.match(result.output, /in 1 TypeScript-Dateien \(100\.00 %\)/);
});

test("typabdeckung: any aus einer JS-Quelle macht rot und nennt Datei, Zeile, Spalte und Namen", (context) => {
  const result = coverage(context, {
    "src/neu.ts": [
      'import { roh } from "./alt.js";',
      "",
      "const wert = roh(1);",
      "export const weiter = wert;",
      "",
    ].join("\n"),
  });
  assert.equal(result.status, EXIT_RED, result.output);
  assert.match(result.output, /^src\/neu\.ts:3:7 wert$/m);
  assert.match(result.output, /^Wozu: /m);
});

test("typabdeckung: any in einem Typargument, as und ! zählen als ungeprüfte Stellen", (context) => {
  const result = coverage(context, {
    "test/neu.ts": [
      "const liste: Array<any> = [];",
      "export const laenge = liste.length;",
      'export const wert = new Map<string, number>().get("a")!;',
      "export const text = (laenge as number).toFixed();",
      "",
    ].join("\n"),
  });
  assert.equal(result.status, EXIT_RED, result.output);
  for (const finding of [
    /^test\/neu\.ts:1:7 liste$/m,
    /^test\/neu\.ts:3:21 !$/m,
    /^test\/neu\.ts:4:22 as number$/m,
  ]) {
    assert.match(result.output, finding);
  }
});

test("typabdeckung: eine gegenüber der Basis gesenkte Untergrenze macht mit --basis rot", (context) => {
  const repo = probeRepository(context, BASE_FILES);
  writeFiles(repo, { [FLOOR_FILE]: floor(LOWER_FLOOR) });
  commitAll(repo, "Untergrenze gesenkt");
  const lowered = runIn(repo, process.execPath, [TOOL, "--basis", "HEAD~1"]);
  const withoutBasis = runIn(repo, process.execPath, [TOOL]);
  assert.deepEqual(
    [lowered.status, withoutBasis.status],
    [EXIT_RED, EXIT_GREEN],
    `${lowered.stdout}${lowered.stderr}`,
  );
  assert.match(lowered.stderr, /mindestens ist von 100 auf 90 gesunken/);
});

test("typabdeckung: eine gleich gebliebene Untergrenze bleibt mit --basis grün", (context) => {
  const result = coverage(context, {}, ["--basis", "HEAD"]);
  assert.equal(result.status, EXIT_GREEN, result.output);
});

test("typabdeckung: any aus einem Aufruf in einer typisierten Stelle, als Argument und als Rückgabe macht rot", (context) => {
  const result = coverage(context, {
    "src/neu.ts": [
      'import { roh } from "./alt.js";',
      "",
      "function nimmt(zahl: number): number {",
      "  return zahl;",
      "}",
      "export const zahl: number = roh(1);",
      'export const genommen = nimmt(JSON.parse("2"));',
      "export function gibt(): number {",
      "  return roh(3);",
      "}",
      "",
    ].join("\n"),
  });
  assert.equal(result.status, EXIT_RED, result.output);
  for (const finding of [
    /^src\/neu\.ts:6:29 roh\(1\)$/m,
    /^src\/neu\.ts:7:31 JSON\.parse\("2"\)$/m,
    /^src\/neu\.ts:9:10 roh\(3\)$/m,
  ]) {
    assert.match(result.output, finding);
  }
});

test("typabdeckung: @ts-nocheck und @ts-ignore zählen als ungeprüfte Stellen", (context) => {
  const result = coverage(context, {
    "src/ohne.ts": ["// @ts-nocheck", 'export const text: number = "x";', ""].join("\n"),
    "src/ignoriert.ts": [
      "export const eins = 1;",
      "// @ts-ignore",
      'export const zwei: number = "y";',
      "",
    ].join("\n"),
  });
  assert.equal(result.status, EXIT_RED, result.output);
  assert.match(result.output, /^src\/ohne\.ts:1:1 @ts-nocheck$/m);
  assert.match(result.output, /^src\/ignoriert\.ts:2:1 @ts-ignore$/m);
});

test("typabdeckung: eine fehlende oder ungültige Untergrenze macht rot", (context) => {
  for (const text of [
    "{}\n",
    "kein json\n",
    floor(-1),
    floor(FULL_FLOOR + 1),
    floor(String(FULL_FLOOR)),
  ]) {
    const result = coverage(context, { [FLOOR_FILE]: text });
    assert.equal(result.status, EXIT_RED, result.output);
    assert.match(result.output, /mindestens fehlt oder liegt nicht zwischen 0 und 100/);
    assert.match(result.output, /^Wozu: /m);
  }
});

test("typabdeckung: eine ungültige Untergrenze an der Basis macht mit --basis rot", (context) => {
  const repo = probeRepository(context, { ...BASE_FILES, [FLOOR_FILE]: floor(FULL_FLOOR + 1) });
  writeFiles(repo, { [FLOOR_FILE]: floor(FULL_FLOOR) });
  commitAll(repo, "Untergrenze repariert");
  const result = runIn(repo, process.execPath, [TOOL, "--basis", "HEAD~1"]);
  assert.equal(result.status, EXIT_RED, `${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /^HEAD~1:tools\/basis\/typabdeckung\.json: mindestens fehlt/m);
});

test("typabdeckung: eine any-Stelle unter neun (88,89 %) besteht Untergrenze 85 und scheitert an 90", (context) => {
  const files = {
    "src/probe.ts":
      'function nimmt(zahl: number): number {\n  return zahl;\n}\nexport const genommen = nimmt(JSON.parse("2"));\n',
  };
  const above = coverage(context, { ...files, [FLOOR_FILE]: floor(PASSING_FLOOR) });
  const below = coverage(context, { ...files, [FLOOR_FILE]: floor(LOWER_FLOOR) });
  assert.equal(above.status, EXIT_GREEN, above.output);
  assert.equal(below.status, EXIT_RED, below.output);
  assert.match(below.output, /8 von 9 Stellen ohne any .* \(88\.89 %\), Untergrenze 90 %/);
});

test("typabdeckung: --basis ohne lesbaren Commit macht rot", (context) => {
  for (const basis of ["", "gibt-es-nicht"]) {
    const result = coverage(context, {}, ["--basis", basis]);
    assert.equal(result.status, EXIT_RED, result.output);
    assert.match(result.output, /ist kein lesbarer Commit/);
  }
});

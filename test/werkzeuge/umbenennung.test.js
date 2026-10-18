import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  REPO_ROOT,
  commitAll,
  outputLines,
  probeRepository,
  runIn,
  writeFiles,
} from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/umbenennung.mjs");
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const NUR_TYPEN = "src/zahl.js → src/zahl.ts: nur Typen ergänzt, Laufzeitcode gleich.";
const GEAENDERT =
  "src/zahl.js → src/zahl.ts: geändert (Laufzeitcode nach Entfernen der Typen anders als vorher).";
const SYNTAX = /^src\/zahl\.js → src\/zahl\.ts: geändert \(TypeScript-Syntax mit Laufzeitwirkung/;
const KEINE = "Keine Umbenennung .js→.ts.";

const JS = [
  'import { grenze } from "./grenze.js";',
  "",
  "export function einordnen(zahl) {",
  '  return zahl < grenze ? "klein" : "gross";',
  "}",
  "",
].join("\n");
const TS = JS.replace("einordnen(zahl)", "einordnen(zahl: number): string");
const BASIS = {
  "src/grenze.js": "export const grenze = 10;\n",
  "src/andere.js": "export const grenze = 20;\n",
  "src/zahl.js": JS,
  "src/aufruf.js": 'import { einordnen } from "./zahl.js";\n\nexport const wert = einordnen(1);\n',
};

function umbenannt(context, inhalt, weitere = {}) {
  const repo = probeRepository(context, BASIS);
  rmSync(join(repo, "src/zahl.js"));
  writeFiles(repo, { "src/zahl.ts": inhalt, ...weitere });
  return repo;
}

function ausgabe(repo, ...argumente) {
  const lauf = runIn(repo, process.execPath, [WERKZEUG, ...argumente]);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
  return outputLines(lauf.stdout);
}

test("eine Umbenennung .js→.ts, die nur Typen ergänzt, gilt im Arbeitsbaum und im Commit als nur Typen", (context) => {
  const repo = umbenannt(context, TS, {
    "src/aufruf.js": BASIS["src/aufruf.js"].replace("./zahl.js", "./zahl.ts"),
  });
  assert.deepEqual(ausgabe(repo, "--basis", "HEAD"), [NUR_TYPEN]);
  commitAll(repo, "Umbenennung");
  assert.deepEqual(ausgabe(repo, "--basis", "HEAD~1", "--bis", "HEAD"), [NUR_TYPEN]);
});

test("mit --streng endet ein geändertes Paar mit Exit 1, ein Paar nur mit Typen mit Exit 0", (context) => {
  const geaendert = runIn(umbenannt(context, `${TS}export const neu = 1;\n`), process.execPath, [
    WERKZEUG,
    "--basis",
    "HEAD",
    "--streng",
  ]);
  assert.equal(geaendert.status, EXIT_ROT, geaendert.stderr);
  assert.deepEqual(outputLines(geaendert.stdout), [GEAENDERT]);
  assert.deepEqual(ausgabe(umbenannt(context, TS), "--basis", "HEAD", "--streng"), [NUR_TYPEN]);
});

test("eine zusätzliche oder geänderte Laufzeitzeile in der umbenannten Datei gilt als geändert", (context) => {
  assert.deepEqual(ausgabe(umbenannt(context, `${TS}export const neu = 1;\n`), "--basis", "HEAD"), [
    GEAENDERT,
  ]);
  assert.deepEqual(
    ausgabe(umbenannt(context, TS.replace("zahl < grenze", "zahl <= grenze")), "--basis", "HEAD"),
    [GEAENDERT],
  );
  assert.deepEqual(
    ausgabe(
      umbenannt(
        context,
        TS.replace(
          "einordnen(zahl: number): string {",
          "einordnen(zahl: number): string {\n  void zahl;",
        ),
      ),
      "--basis",
      "HEAD",
    ),
    [GEAENDERT],
  );
});

test("ein Klassenfeld nur mit Typ ist Laufzeitcode und gilt als geändert", (context) => {
  assert.deepEqual(
    ausgabe(
      umbenannt(context, `${TS}export class Halter {\n  wert: number;\n}\n`),
      "--basis",
      "HEAD",
    ),
    [GEAENDERT],
  );
});

test("enum, namespace mit Werten, Parameter-Property und <T>-Assertion gelten als geändert", (context) => {
  const faelle = [
    `${TS}export enum Art {\n  A,\n}\n`,
    `${TS}export namespace Raum {\n  export const a = 1;\n}\n`,
    `${TS}export class Halter {\n  constructor(private wert: number) {}\n}\n`,
    TS.replace("zahl < grenze", "<number>zahl < grenze"),
  ];
  for (const inhalt of faelle) {
    const [zeile] = ausgabe(umbenannt(context, inhalt), "--basis", "HEAD");
    assert.match(zeile, SYNTAX, inhalt);
  }
});

test("eine Importquelle auf ein anderes Modul gilt als geändert", (context) => {
  const repo = umbenannt(context, TS.replace("./grenze.js", "./andere.js"));
  assert.deepEqual(ausgabe(repo, "--basis", "HEAD"), [GEAENDERT]);
});

test("eine umbenannte Datei, die ihren eigenen Pfad liest, gilt als geändert", (context) => {
  const [zeile] = ausgabe(
    umbenannt(context, `${TS}export const ort = import.meta.url;\n`),
    "--basis",
    "HEAD",
  );
  assert.match(zeile, /: geändert \(Laufzeitcode liest den eigenen Dateipfad/);
});

test("as und ! entfernt die Typentfernung; der Baustein meldet nur Typen, die Lint-Sperrregeln bleiben zuständig", (context) => {
  const repo = umbenannt(context, TS.replace("zahl < grenze", "(zahl as number)! < grenze"));
  assert.deepEqual(ausgabe(repo, "--basis", "HEAD"), [NUR_TYPEN]);
});

test("eine Verschiebung in einen anderen Ordner, eine andere Endung oder eine bleibende .js-Datei bilden kein Paar", (context) => {
  const verschoben = umbenannt(context, JS);
  rmSync(join(verschoben, "src/zahl.ts"));
  writeFiles(verschoben, { "src/neu/zahl.ts": JS.replace("./grenze.js", "../grenze.js") });
  assert.deepEqual(ausgabe(verschoben, "--basis", "HEAD"), [KEINE]);
  const endung = umbenannt(context, JS);
  rmSync(join(endung, "src/zahl.ts"));
  writeFiles(endung, { "src/zahl.mts": JS });
  assert.deepEqual(ausgabe(endung, "--basis", "HEAD"), [KEINE]);
  const daneben = probeRepository(context, BASIS);
  writeFiles(daneben, { "src/zahl.ts": TS });
  assert.deepEqual(ausgabe(daneben, "--basis", "HEAD"), [KEINE]);
});

test("ohne --basis bricht der Aufruf mit Hinweis ab", (context) => {
  const lauf = runIn(probeRepository(context, BASIS), process.execPath, [WERKZEUG]);
  assert.equal(lauf.status, EXIT_ABBRUCH);
  assert.match(lauf.stderr, /^Aufruf: node tools\/umbenennung\.mjs --basis <commit>/m);
});

test(".mjs→.mts mit nur Typen ist ein Paar; .cjs→.cts, das module liest, gilt als geändert", (context) => {
  const mjs = probeRepository(context, { "src/teil.mjs": "export const teil = (wert) => wert;\n" });
  rmSync(join(mjs, "src/teil.mjs"));
  writeFiles(mjs, { "src/teil.mts": "export const teil = (wert: number): number => wert;\n" });
  assert.deepEqual(ausgabe(mjs, "--basis", "HEAD"), [
    "src/teil.mjs → src/teil.mts: nur Typen ergänzt, Laufzeitcode gleich.",
  ]);
  const cjs = probeRepository(context, {
    "src/ort.cjs": "const ort = module.filename;\nexports.ort = ort;\n",
  });
  rmSync(join(cjs, "src/ort.cjs"));
  writeFiles(cjs, { "src/ort.cts": "const ort: string = module.filename;\nexports.ort = ort;\n" });
  const [zeile] = ausgabe(cjs, "--basis", "HEAD");
  assert.match(
    zeile,
    /^src\/ort\.cjs → src\/ort\.cts: geändert \(Laufzeitcode liest den eigenen Dateipfad/,
  );
});

function vormerken(repo, ...argumente) {
  const lauf = runIn(repo, "git", ["add", ...argumente]);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
}

test('im Index-Stand (--bis "") zählt nur Vorgemerktes; eine nicht vorgemerkte Löschung ergibt kein Paar', (context) => {
  const repo = umbenannt(context, TS);
  const imIndex = () => ausgabe(repo, "--basis", "HEAD", "--bis", "");
  assert.deepEqual(ausgabe(repo, "--basis", "HEAD"), [NUR_TYPEN]);
  assert.deepEqual(imIndex(), [KEINE]);
  vormerken(repo, "src/zahl.ts");
  assert.deepEqual(imIndex(), [KEINE]);
  vormerken(repo, "-A");
  rmSync(join(repo, "src/zahl.ts"));
  assert.deepEqual(imIndex(), [NUR_TYPEN]);
  writeFiles(repo, { "src/zahl.ts": `${TS}export const neu = 1;\n` });
  assert.deepEqual(imIndex(), [NUR_TYPEN]);
  assert.deepEqual(ausgabe(repo, "--basis", "HEAD"), [GEAENDERT]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const WURZEL = path.resolve(import.meta.dirname, "../..");
const TYPEN_WURZEL = path.dirname(path.dirname(createRequire(import.meta.url).resolve("@types/node/package.json")));
const PROBE = path.join(WURZEL, "src", "telephony", "zz-probe-3405-h2.ts");
const ARGUMENTE_FALSCH = 2554;
const PRIVATER_KONSTRUKTOR = 2673;
const TYP_NICHT_ZUWEISBAR = 2741;

function diagnosen(datei, textFuer) {
  const optionen = {
    target: ts.ScriptTarget.ES2024,
    lib: ["lib.es2024.d.ts"],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ["node"],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowJs: true,
    checkJs: false,
    erasableSyntaxOnly: true,
    rewriteRelativeImportExtensions: true,
    typeRoots: [TYPEN_WURZEL],
  };
  const host = ts.createCompilerHost(optionen);
  const lies = host.readFile.bind(host);
  const gibt = host.fileExists.bind(host);
  const quelle = host.getSourceFile.bind(host);
  const ersetzt = (name) => name === datei && textFuer(name) !== null;
  host.fileExists = (name) => ersetzt(name) || gibt(name);
  host.readFile = (name) => (ersetzt(name) ? textFuer(name) : lies(name));
  host.getSourceFile = (name, sprache, ...rest) =>
    ersetzt(name) ? ts.createSourceFile(name, textFuer(name), sprache) : quelle(name, sprache, ...rest);
  const programm = ts.createProgram([datei], optionen, host);
  return ts.getPreEmitDiagnostics(programm, programm.getSourceFile(datei));
}

test("waehleAnruf verlangt den Nachweis: ein Aufruf ohne ihn uebersetzt nicht, mit ihm schon", () => {
  const kopf = [
    'import type { WaehleAnruf } from "../routes/api-calls.ts";',
    'import type { GatesBestanden } from "./gates-bestanden.ts";',
    "declare const waehle: WaehleAnruf;",
    "declare const anruf: Parameters<WaehleAnruf>[0];",
    "declare const nachweis: GatesBestanden;",
  ];
  const ohne = [...kopf, "export const a = waehle(anruf);"].join("\n");
  const mit = [...kopf, "export const a = waehle(anruf, nachweis);"].join("\n");
  assert.deepEqual(diagnosen(PROBE, () => ohne).map((d) => d.code), [ARGUMENTE_FALSCH]);
  assert.deepEqual(diagnosen(PROBE, () => mit), []);
});

test("der Nachweis laesst sich ausserhalb des Ausstellers weder bauen noch nachbilden", () => {
  const probe = [
    'import { GatesBestanden } from "./gates-bestanden.ts";',
    "export const gebaut = new GatesBestanden();",
    "export const nachgebildet: GatesBestanden = { gilt: true };",
  ].join("\n");
  const codes = diagnosen(PROBE, () => probe).map((d) => d.code);
  assert.deepEqual(codes, [PRIVATER_KONSTRUKTOR, TYP_NICHT_ZUWEISBAR]);
});

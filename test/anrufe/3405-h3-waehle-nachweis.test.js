import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const WURZEL = path.resolve(import.meta.dirname, "../..");
const TYPEN_WURZEL = path.dirname(path.dirname(createRequire(import.meta.url).resolve("@types/node/package.json")));
const DATEI = path.join(WURZEL, "src", "routes", "api-calls.ts");
const ARGUMENTE_FALSCH = 2554;
const NAME_UNBEKANNT = 2304;

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


function ohneNachweis(text, aufruf) {
  assert.ok(text.includes(aufruf), aufruf);
  return text.replace(aufruf, aufruf.replace(", bestanden", "").replace(", ergebnis", ""));
}

test("die Wartenschlange waehlt nicht ohne Nachweis: starteWartendenAnruf uebersetzt ohne ihn nicht", () => {
  const original = fs.readFileSync(DATEI, "utf8");
  assert.deepEqual(diagnosen(DATEI, () => null).map((d) => d.code), []);
  const codes = diagnosen(DATEI, () => ohneNachweis(original, "await waehleAnruf(call, bestanden)")).map((d) => d.code);
  assert.deepEqual(codes, [ARGUMENTE_FALSCH]);
});

test("es gibt keine Waehlfunktion neben waehleAnruf, die ohne Nachweis erreichbar waere", () => {
  const original = fs.readFileSync(DATEI, "utf8");
  const zurueck = original.replace("await waehleAnruf(call, bestanden)", "await waehleKern(call)");
  assert.notEqual(zurueck, original);
  const codes = diagnosen(DATEI, () => zurueck).map((d) => d.code);
  assert.deepEqual(codes, [NAME_UNBEKANNT]);
});

test("auch der Direktweg waehlt nicht ohne Nachweis", () => {
  const original = fs.readFileSync(DATEI, "utf8");
  const codes = diagnosen(DATEI, () => ohneNachweis(original, "await waehleAnruf(call, ergebnis)")).map((d) => d.code);
  assert.deepEqual(codes, [ARGUMENTE_FALSCH]);
});

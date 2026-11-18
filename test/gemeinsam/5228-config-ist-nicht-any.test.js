import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";

const WURZEL = path.resolve(import.meta.dirname, "../..");
const PROBE = path.join(WURZEL, "src", "zz-probe-5228.ts");
const PROBE_TEXT = [
  'import { config } from "./config.js";',
  "const probe: { nichtAny: true } = config;",
  "export { probe };",
].join("\n");

function probeDiagnosen() {
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
    rewriteRelativeImportExtensions: true,
    typeRoots: [path.join(WURZEL, "node_modules", "@types")],
  };
  const host = ts.createCompilerHost(optionen);
  const lies = host.readFile.bind(host);
  const gibt = host.fileExists.bind(host);
  const quelle = host.getSourceFile.bind(host);
  host.fileExists = (name) => name === PROBE || gibt(name);
  host.readFile = (name) => (name === PROBE ? PROBE_TEXT : lies(name));
  host.getSourceFile = (name, sprache, ...rest) =>
    name === PROBE ? ts.createSourceFile(name, PROBE_TEXT, sprache) : quelle(name, sprache, ...rest);
  const programm = ts.createProgram([PROBE], optionen, host);
  return ts.getPreEmitDiagnostics(programm, programm.getSourceFile(PROBE));
}

test("config ist ein fester Typ und nicht any (die Probezuweisung an ein fremdes Objekt wird abgelehnt)", () => {
  const diagnosen = probeDiagnosen();
  assert.deepEqual(
    diagnosen.map((d) => d.code),
    [2741],
  );
});

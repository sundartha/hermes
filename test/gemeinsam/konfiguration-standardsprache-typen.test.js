import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

const WURZEL = path.resolve(import.meta.dirname, "../..");
const KONFIG = path.join(WURZEL, "src", "konfiguration");

function diagnosenFuer(zeilen) {
  const ordner = mkdtempSync(path.join(tmpdir(), "typprobe-"));
  const datei = path.join(ordner, "probe.ts");
  writeFileSync(datei, zeilen.join("\n"));
  try {
    const programm = ts.createProgram([datei], {
      target: ts.ScriptTarget.ES2024,
      lib: ["lib.es2024.d.ts"],
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      types: ["node"],
      typeRoots: [path.join(WURZEL, "node_modules", "@types")],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      allowJs: true,
      checkJs: false,
      rewriteRelativeImportExtensions: true,
    });
    return ts
      .getPreEmitDiagnostics(programm, programm.getSourceFile(datei))
      .map((d) => `${ts.getLineAndCharacterOfPosition(d.file, d.start).line + 1}:${d.code}`);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

const importVon = (name, datei) => `import { ${name} } from ${JSON.stringify(path.join(KONFIG, datei))};`;

const FALL = [
  {
    name: "standardsprache: Schalter ist ein boolean, Sprache ein String, Ergebnis void",
    zeilen: [
      importVon("DEFAULT_LANGUAGE, setWorldDefaultLanguageEnabled", "standardsprache.js"),
      'setWorldDefaultLanguageEnabled("ja");',
      "const zahl: number = DEFAULT_LANGUAGE;",
      "const ergebnis: number = setWorldDefaultLanguageEnabled(true);",
    ],
    erwartet: ["2:2345", "3:2322", "4:2322"],
  },
];

for (const { name, zeilen, erwartet } of FALL) {
  test(`${name} (kein any)`, () => {
    assert.deepEqual(diagnosenFuer(zeilen), erwartet);
  });
}

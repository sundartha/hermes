import assert from "node:assert/strict";
import { test } from "node:test";

import { probeRepository, runIn, TEST_RATIO_TOOL } from "./probe-repo.js";

const LIMIT_PATH = "tools/basis/testverhaeltnis.json";
const RATIO_LIMIT = 2;
const EXIT_OK = 0;
const EXIT_FINDING = 1;

const PRODUCT_WITH_TWO_CODE_LINES = [
  "// Kommentar zählt nicht",
  "export const a = 1;",
  "",
  "export const b = 2;",
  "",
].join("\n");

const TEST_WITH_FOUR_CODE_LINES = [
  'import { test } from "node:test";',
  "",
  "   ",
  "// reine Zeilenkommentare zählen nicht",
  "/**",
  " * Blockkommentare über mehrere Zeilen zählen nicht",
  " */",
  "/* einzeiliger Blockkommentar zählt nicht */",
  "/* Code nach einem Blockkommentar zählt */ const a = 1;",
  "const b = 2; // Code mit Kommentar am Ende zählt",
  'test("probe", () => {});',
  "",
].join("\n");

function checkRatio(context, files) {
  const directory = probeRepository(context, {
    [LIMIT_PATH]: JSON.stringify({ obergrenze: RATIO_LIMIT }),
    "src/produkt.js": PRODUCT_WITH_TWO_CODE_LINES,
    "test/probe.test.js": TEST_WITH_FOUR_CODE_LINES,
    ...files,
  });
  return runIn(directory, process.execPath, [TEST_RATIO_TOOL]);
}

test("das Testverhältnis zählt nur Code-Zeilen, keine leeren Zeilen und keine reinen Kommentarzeilen", (context) => {
  const result = checkRatio(context, {});
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.match(result.stdout, /Testverhältnis 2\.00 \(4 Testzeilen zu 2 Produktzeilen\)/);
});

test("nur JavaScript-Dateien in test/ und src/ zählen, Daten und andere Ordner nicht", (context) => {
  const result = checkRatio(context, {
    "test/fixture.json": '{\n  "a": 1,\n  "b": 2\n}\n',
    "tools/werkzeug.mjs": "export const x = 1;\n",
    "src/ui/seite.html": "<p>\nText\n</p>\n",
  });
  assert.match(result.stdout, /\(4 Testzeilen zu 2 Produktzeilen\)/);
});

test("eine Testzeile über der Obergrenze macht die Prüfung rot", (context) => {
  const result = checkRatio(context, { "test/mehr.test.js": "const c = 3;\n" });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(
    result.stderr,
    /Testverhältnis 2\.50 \(5 Testzeilen zu 2 Produktzeilen\), Obergrenze 2/,
  );
});

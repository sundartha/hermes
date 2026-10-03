import assert from "node:assert/strict";
import { test } from "node:test";

import { probeRepository, runIn, TEST_RATIO_TOOL } from "./probe-repo.js";

const EXIT_OK = 0;
const TEN_TEST_LINES = 10;

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

function probe(context, files) {
  return probeRepository(context, {
    "src/produkt.js": PRODUCT_WITH_TWO_CODE_LINES,
    "test/probe.test.js": TEST_WITH_FOUR_CODE_LINES,
    ...files,
  });
}

function checkRatio(context, files) {
  return runIn(probe(context, files), process.execPath, [TEST_RATIO_TOOL, "--basis", "HEAD"]);
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

test("Tests unter test/werkzeuge/ zählen gegen tools/ und scripts/, nicht gegen src/", (context) => {
  const result = checkRatio(context, {
    "test/werkzeuge/pruefung.test.js": "const c = 3;\nconst d = 4;\n",
    "tools/pruefung.mjs": "export const e = 5;\n",
    "scripts/skript.mjs": "export const f = 6;\n",
  });
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.match(result.stdout, /Testverhältnis 2\.00 \(4 Testzeilen zu 2 Produktzeilen\)/);
  assert.match(
    result.stdout,
    /Werkzeug-Testverhältnis 1\.00 \(2 Testzeilen zu 2 Werkzeug- und Skriptzeilen\)/,
  );
});

test("ein hohes Werkzeug-Testverhältnis hält die Prüfung nicht auf und erscheint als Hinweis", (context) => {
  const result = checkRatio(context, {
    "test/werkzeuge/pruefung.test.js": "const c = 3;\nconst d = 4;\nconst g = 7;\n",
    "tools/pruefung.mjs": "export const e = 5;\n",
    "scripts/skript.mjs": "export const f = 6;\n",
  });
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.match(
    result.stdout,
    /^::notice::Werkzeug-Testverhältnis 1\.50 \(3 Testzeilen zu 2 Werkzeug- und Skriptzeilen\)/m,
  );
});

test("zehn Testzeilen auf eine Produktzeile halten die Prüfung nicht auf und erscheinen als Hinweis", (context) => {
  const tenTestLines = Array.from({ length: TEN_TEST_LINES }, (_unused, index) => `export const fall${index} = true;`);
  const result = checkRatio(context, {
    "src/produkt.js": "export const wert = true;\n",
    "test/probe.test.js": `${tenTestLines.join("\n")}\n`,
  });
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.match(result.stdout, /^::notice::Testverhältnis 10\.00 \(10 Testzeilen zu 1 Produktzeilen\)/m);
});

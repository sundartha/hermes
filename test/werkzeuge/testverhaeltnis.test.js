import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { probeRepository, runIn, TEST_RATIO_TOOL } from "./probe-repo.js";

const LIMIT_PATH = "tools/basis/testverhaeltnis.json";
const RATIO_LIMIT = 2;
const TOOL_RATIO_LIMIT = 1;
const LIMITS = {
  produkt: { obergrenze: RATIO_LIMIT },
  werkzeuge: { obergrenze: TOOL_RATIO_LIMIT },
};
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_ABORT = 2;

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
    [LIMIT_PATH]: JSON.stringify(LIMITS),
    "src/produkt.js": PRODUCT_WITH_TWO_CODE_LINES,
    "test/probe.test.js": TEST_WITH_FOUR_CODE_LINES,
    ...files,
  });
}

function runTool(directory) {
  return runIn(directory, process.execPath, [TEST_RATIO_TOOL, "--basis", "HEAD"]);
}

function checkRatio(context, files) {
  return runTool(probe(context, files));
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

test("eine Werkzeug-Testzeile über der eigenen Obergrenze macht die Prüfung rot", (context) => {
  const result = checkRatio(context, {
    "test/werkzeuge/pruefung.test.js": "const c = 3;\nconst d = 4;\nconst g = 7;\n",
    "tools/pruefung.mjs": "export const e = 5;\n",
    "scripts/skript.mjs": "export const f = 6;\n",
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.stderr, /Werkzeug-Testverhältnis 1\.50 .*Obergrenze 1 /);
});

test("eine angehobene Obergrenze macht die Prüfung rot, auch wenn das Verhältnis darunter bleibt", (context) => {
  const directory = probe(context, {});
  const raised = { produkt: { obergrenze: 3 }, werkzeuge: { obergrenze: 2 } };
  writeFileSync(join(directory, LIMIT_PATH), JSON.stringify(raised));
  const result = runTool(directory);
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.stderr, /produkt\.obergrenze steigt von 2 auf 3; sie darf nur sinken/);
  assert.match(result.stderr, /werkzeuge\.obergrenze steigt von 1 auf 2; sie darf nur sinken/);
});

test("eine gesenkte Obergrenze ist erlaubt", (context) => {
  const directory = probe(context, {});
  const lowered = { produkt: { obergrenze: RATIO_LIMIT }, werkzeuge: { obergrenze: 0.5 } };
  writeFileSync(join(directory, LIMIT_PATH), JSON.stringify(lowered));
  const result = runTool(directory);
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("eine Testzeile über der Obergrenze macht die Prüfung rot", (context) => {
  const result = checkRatio(context, { "test/mehr.test.js": "const c = 3;\n" });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(
    result.stderr,
    /Testverhältnis 2\.50 \(5 Testzeilen zu 2 Produktzeilen\), Obergrenze 2/,
  );
});

test("eine Basis, die kein Commit ist, bricht die Prüfung ab", (context) => {
  const directory = probe(context, {});
  const blob = runIn(directory, "git", ["rev-parse", `HEAD:${LIMIT_PATH}`]).stdout.trim();
  for (const basis of ["gibt-es-nicht", blob]) {
    const result = runIn(directory, process.execPath, [TEST_RATIO_TOOL, "--basis", basis]);
    assert.equal(result.status, EXIT_ABORT, basis);
    assert.match(result.stderr, /ist kein Commit in diesem Checkout/);
  }
});

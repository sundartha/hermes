import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { kannNamenErzeugen } from "../../tools/mutationspruefung/testnamen-statisch.mjs";

const NAME = "falscher Token -> 403";
const KOPF = 'import { test } from "node:test";\n';

function pruefe(context, dateien) {
  const wurzel = mkdtempSync(join(tmpdir(), "testnamen-"));
  context.after(() => rmSync(wurzel, { recursive: true, force: true }));
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(join(wurzel, dirname(pfad)), { recursive: true });
    writeFileSync(join(wurzel, pfad), inhalt);
  }
  return kannNamenErzeugen("test/fremd.test.js", NAME, wurzel);
}

const FALLEN = {
  "Template mit Platzhalter": `${KOPF}for (const art of ["falscher Token"]) test(\`\${art} -> 403\`, () => {});\n`,
  "Variable als Name": `${KOPF}const NAME = "falscher Token -> 403";\ntest(NAME, () => {});\n`,
  "zusammengesetzter Name": `${KOPF}test("falscher Token" + " -> 403", () => {});\n`,
  "Name mit Escape": `${KOPF}test("falscher Token -\\u003e 403", () => {});\n`,
  "Unterprüfung mit Template": `${KOPF}test("a", async (t) => {\n  await t.test(\`\${"falscher Token"} -> 403\`, () => {});\n});\n`,
  "Name als Text": `${KOPF}test("falscher Token -> 403", () => {});\n`,
  "Name verschachtelt in Gruppe": `import { describe, it } from "node:test";\ndescribe("g", () => {\n  it("falscher Token -> 403", () => {});\n});\n`,
  "Name mit only": `${KOPF}test.only("falscher Token -> 403", () => {});\n`,
  "Name als Vorlage ohne Platzhalter": `${KOPF}test(\`falscher Token -> 403\`, () => {});\n`,
  "umbenannter Import": 'import { test as fall } from "node:test";\nfall("anders", () => {});\n',
  "Namensraum-Import": 'import * as knoten from "node:test";\nknoten.test("anders", () => {});\n',
  "Test als Wert weitergereicht": `${KOPF}["x"].forEach(test);\n`,
  "Test über require": 'const { test } = require("node:test");\ntest("anders", () => {});\n',
  "Test über dynamischen Import": 'const { test } = await import("node:test");\ntest("anders", () => {});\n',
  "Importpfad zur Laufzeit": `${KOPF}await import(process.env.NAECHSTE);\ntest("anders", () => {});\n`,
  "nicht lesbarer Quelltext": `${KOPF}test("anders", () => {\n`,
  "nicht auffindbarer Import": `${KOPF}import "./gibt-es-nicht.js";\ntest("anders", () => {});\n`,
  "Unterprüfung ohne Name": `${KOPF}test("a", (t) => {\n  t.test(name);\n});\n`,
};

for (const [beschreibung, inhalt] of Object.entries(FALLEN)) {
  test(`eine Testdatei mit "${beschreibung}" läuft in der Gegenprobe mit`, (context) => {
    assert.equal(pruefe(context, { "test/fremd.test.js": inhalt }), true);
  });
}

test("eine Testdatei, deren Tests alle feste andere Namen tragen, läuft nicht mit", (context) => {
  const inhalt = `${KOPF}test("richtiger Token -> 200", () => {});\ntest.skip("anderer", () => {});\n`;
  assert.equal(pruefe(context, { "test/fremd.test.js": inhalt }), false);
});

test("ein Regex-Aufruf mit test() in der Testdatei und im Hilfsmodul gilt nicht als Testname", (context) => {
  const dateien = {
    "test/fremd.test.js": `${KOPF}import { gueltig } from "../src/muster.js";\nconst MUSTER = /^a$/;\ntest("anders", () => {\n  MUSTER.test("a");\n  gueltig("a");\n  /b/.test("b");\n});\n`,
    "src/muster.js": 'const E164 = new RegExp("^\\\\+");\nexport const gueltig = (text) => E164.test(text) && /^a$/.test(text) && text.test(1);\n',
  };
  assert.equal(pruefe(context, dateien), false);
});

test("ein Hilfsmodul, das Tests mit berechnetem Namen anlegt, macht die importierende Testdatei mitlaufend", (context) => {
  const dateien = {
    "test/fremd.test.js": 'import { vertrag } from "./vertrag.mjs";\nvertrag("x");\n',
    "test/vertrag.mjs": `${KOPF}export function vertrag(art) {\n  test(\`\${art} -> 403\`, () => {});\n}\n`,
  };
  assert.equal(pruefe(context, dateien), true);
});

test("ein Hilfsmodul über zwei Stufen mit dem Namen als Text macht die importierende Testdatei mitlaufend", (context) => {
  const dateien = {
    "test/fremd.test.js": 'import { eins } from "./eins.mjs";\neins();\n',
    "test/eins.mjs": 'export { zwei as eins } from "./zwei.mjs";\n',
    "test/zwei.mjs": `${KOPF}export const zwei = () => test("falscher Token -> 403", () => {});\n`,
  };
  assert.equal(pruefe(context, dateien), true);
});

test("ein Hilfsmodul ohne Tests mit dem Namen läuft nicht mit, auch bei zyklischem Import", (context) => {
  const dateien = {
    "test/fremd.test.js": `${KOPF}import { eins } from "./eins.mjs";\ntest("anders", () => eins());\n`,
    "test/eins.mjs": 'import { zwei } from "./zwei.mjs";\nexport const eins = () => zwei;\n',
    "test/zwei.mjs": 'import { eins } from "./eins.mjs";\nexport const zwei = 1;\nexport const wieder = eins;\n',
  };
  assert.equal(pruefe(context, dateien), false);
});

test("ein Import über createRequire mit festem Pfad wird verfolgt", (context) => {
  const dateien = {
    "test/fremd.test.js": `${KOPF}import { createRequire } from "node:module";\nconst laden = createRequire(import.meta.url);\nladen("./vertrag.cjs");\ntest("anders", () => {});\n`,
    "test/vertrag.cjs": `const { test } = require("node:test");\ntest("falscher Token -> 403", () => {});\n`,
  };
  assert.equal(pruefe(context, dateien), true);
});

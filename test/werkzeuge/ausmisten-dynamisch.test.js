import assert from "node:assert/strict";
import { chdir, cwd } from "node:process";
import { test } from "node:test";

import { erreichendeTests, importgraph } from "../../tools/tests-ausmisten/messmenge.mjs";
import { FREMDE_QUELLE, GRUNDDATEIEN, RECHNEN_TEST } from "./ausmisten/hilfen.mjs";
import { EXIT_GRUEN, EXIT_ROT, erwarteBranchUndMeldenGruen, messeUndMelde } from "./ausmisten/messung.mjs";
import { probeDirectory } from "./probe-repo.js";

const ZIEL = "src/rechnen.js";
const NAHT_TEST = "test/post/naht.test.js";

function nahtTest(name) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    "",
    'const SEAM = Object.freeze({ module: "../../src/fremd/rechnen.js", export: "doppelt" });',
    "",
    `test(${JSON.stringify(name)}, async () => {`,
    "  const modul = await import(SEAM.module);",
    "  assert.equal(modul[SEAM.export](3), 6);",
    "});",
    "",
  ].join("\n");
}

const NAHT_DATEIEN = {
  [NAHT_TEST]: nahtTest("verdoppelt über die Naht"),
  [RECHNEN_TEST]: GRUNDDATEIEN["test/uhr.test.js"],
};

async function erreicht(context, zeilen) {
  const ordner = probeDirectory(context, {
    "package.json": `${JSON.stringify({ type: "module" })}\n`,
    [ZIEL]: "export const wert = 1;\n",
    "test/a.test.js": `${zeilen.join("\n")}\n`,
  });
  const vorher = cwd();
  chdir(ordner);
  try {
    return erreichendeTests(ZIEL, await importgraph());
  } finally {
    chdir(vorher);
  }
}

const FORMEN = {
  "ein Literal mit Anhang": ['await import("../src/rechnen.js?stand=1");'],
  "eine Vorlage mit berechnetem Anhang": [
    "const stand = Date.now();",
    "await import(`../src/rechnen.js?stand=${stand}`);",
  ],
  "eine Konstante": ['const PFAD = "../src/rechnen.js";', "await import(PFAD);"],
  "eine Eigenschaft eines eingefrorenen Objekts": [
    'const SEAM = Object.freeze({ module: "../src/rechnen.js" });',
    "await import(SEAM.module);",
  ],
  "eine Eigenschaft eines Objekts in eckigen Klammern": [
    'const SEAM = { "modul": "../src/rechnen.js" };',
    'await import(SEAM["modul"]);',
  ],
  "eine URL neben import.meta.url": [
    'await import(new URL("../src/rechnen.js", import.meta.url).href);',
  ],
  "eine URL als Konstante": [
    'const ORT = new URL("../src/rechnen.js", import.meta.url);',
    "await import(ORT.href);",
  ],
};

for (const [form, zeilen] of Object.entries(FORMEN)) {
  test(`ausmisten-dynamisch: ein dynamischer Import über ${form} erreicht die Datei`, async (context) => {
    assert.deepEqual(await erreicht(context, zeilen), ["test/a.test.js"]);
  });
}

const KEINE_IMPORTE = {
  "der Pfad nur als Text": ['const PFAD = "../src/rechnen.js";', "void PFAD;"],
  "eine veränderliche Variable": ['let pfad = "../src/rechnen.js";', "await import(pfad);"],
  "eine Vorlage, die vor dem Anhang rechnet": [
    'const ordner = "src";',
    "await import(`../${ordner}/rechnen.js`);",
  ],
  "eine doppelt vergebene Konstante": [
    'const PFAD = "../src/rechnen.js";',
    "{",
    '  const PFAD = "../src/anders.js";',
    "  await import(PFAD);",
    "}",
  ],
};

for (const [form, zeilen] of Object.entries(KEINE_IMPORTE)) {
  test(`ausmisten-dynamisch: ${form} erreicht die Datei nicht`, async (context) => {
    assert.deepEqual(await erreicht(context, zeilen), []);
  });
}

test("ausmisten-dynamisch: ein umbenannter Test, der seine Datei über eine Naht lädt, bleibt grün", async (context) => {
  const neu = { [NAHT_TEST]: nahtTest("verdoppelt über die Naht, umbenannt") };
  const ergebnis = await messeUndMelde(context, { weg: [], neu }, { dateien: NAHT_DATEIEN });
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.ok(ergebnis.gelesen.erreicht.includes(FREMDE_QUELLE), ergebnis.basis.ausgabe);
  erwarteBranchUndMeldenGruen(ergebnis);
});

test("ausmisten-dynamisch: ein gelöschter Test, der seine Datei über eine Naht lädt, wird rot", async (context) => {
  const ergebnis = await messeUndMelde(context, { weg: [NAHT_TEST] }, { dateien: NAHT_DATEIEN });
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.equal(ergebnis.melden.status, EXIT_ROT, ergebnis.melden.ausgabe);
  assert.match(
    ergebnis.melden.ausgabe,
    /Mutant auf dem Branch nicht mehr getötet: src\/fremd\/rechnen\.js:/,
  );
});

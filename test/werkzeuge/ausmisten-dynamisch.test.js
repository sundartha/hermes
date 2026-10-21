import assert from "node:assert/strict";
import { chdir, cwd } from "node:process";
import { test } from "node:test";

import {
  erreichendeTests,
  graphImStand,
  importgraph,
  messmenge,
} from "../../tools/tests-ausmisten/messmenge.mjs";
import { FREMDE_QUELLE, GRUNDDATEIEN, RECHNEN_TEST } from "./ausmisten/hilfen.mjs";
import {
  EXIT_GRUEN,
  EXIT_ROT,
  erwarteBranchUndMeldenGruen,
  messeUndMelde,
} from "./ausmisten/messung.mjs";
import { commitAll, probeDirectory, probeRepository, writeFiles } from "./probe-repo.js";

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

async function erwarteErreicht(context, zeilen) {
  assert.deepEqual(await erreicht(context, zeilen), ["test/a.test.js"]);
}

async function erwarteUnerreicht(context, zeilen) {
  assert.deepEqual(await erreicht(context, zeilen), []);
}

test("ausmisten-dynamisch: ein dynamischer Import über ein Literal mit Anhang erreicht die Datei", async (context) => {
  await erwarteErreicht(context, ['await import("../src/rechnen.js?stand=1");']);
});

test("ausmisten-dynamisch: ein dynamischer Import über eine Vorlage mit berechnetem Anhang erreicht die Datei", async (context) => {
  await erwarteErreicht(context, [
    "const stand = Date.now();",
    "await import(`../src/rechnen.js?stand=${stand}`);",
  ]);
});

test("ausmisten-dynamisch: ein dynamischer Import über eine Konstante erreicht die Datei", async (context) => {
  await erwarteErreicht(context, ['const PFAD = "../src/rechnen.js";', "await import(PFAD);"]);
});

test("ausmisten-dynamisch: ein dynamischer Import über eine Eigenschaft eines eingefrorenen Objekts erreicht die Datei", async (context) => {
  await erwarteErreicht(context, [
    'const SEAM = Object.freeze({ module: "../src/rechnen.js" });',
    "await import(SEAM.module);",
  ]);
});

test("ausmisten-dynamisch: ein dynamischer Import über eine Eigenschaft eines Objekts in eckigen Klammern erreicht die Datei", async (context) => {
  await erwarteErreicht(context, [
    'const SEAM = { "modul": "../src/rechnen.js" };',
    'await import(SEAM["modul"]);',
  ]);
});

test("ausmisten-dynamisch: ein dynamischer Import über eine URL neben import.meta.url erreicht die Datei", async (context) => {
  await erwarteErreicht(context, [
    'await import(new URL("../src/rechnen.js", import.meta.url).href);',
  ]);
});

test("ausmisten-dynamisch: ein dynamischer Import über eine URL als Konstante erreicht die Datei", async (context) => {
  await erwarteErreicht(context, [
    'const ORT = new URL("../src/rechnen.js", import.meta.url);',
    "await import(ORT.href);",
  ]);
});

test("ausmisten-dynamisch: der Pfad nur als Text erreicht die Datei nicht", async (context) => {
  await erwarteUnerreicht(context, ['const PFAD = "../src/rechnen.js";', "void PFAD;"]);
});

test("ausmisten-dynamisch: eine veränderliche Variable erreicht die Datei nicht", async (context) => {
  await erwarteUnerreicht(context, ['let pfad = "../src/rechnen.js";', "await import(pfad);"]);
});

test("ausmisten-dynamisch: eine Vorlage, die vor dem Anhang rechnet erreicht die Datei nicht", async (context) => {
  await erwarteUnerreicht(context, [
    'const ordner = "src";',
    "await import(`../${ordner}/rechnen.js`);",
  ]);
});

test("ausmisten-dynamisch: eine doppelt vergebene Konstante erreicht die Datei nicht", async (context) => {
  await erwarteUnerreicht(context, [
    'const PFAD = "../src/rechnen.js";',
    "{",
    '  const PFAD = "../src/anders.js";',
    "  await import(PFAD);",
    "}",
  ]);
});

async function erwarteVerschattet(context, zeilen) {
  await erwarteUnerreicht(context, ['const PFAD = "../src/rechnen.js";', ...zeilen]);
}

test("ausmisten-dynamisch: ein Parameter, der eine Konstante verschattet, erreicht die Datei nicht", async (context) => {
  await erwarteVerschattet(context, [
    "const lade = (PFAD) => import(PFAD);",
    'await lade("./anders.js");',
  ]);
});

test("ausmisten-dynamisch: ein catch-Parameter, der eine Konstante verschattet, erreicht die Datei nicht", async (context) => {
  await erwarteVerschattet(context, [
    "try {",
    "  throw 1;",
    "} catch (PFAD) {",
    "  await import(PFAD);",
    "}",
  ]);
});

test("ausmisten-dynamisch: ein Funktionsname, der eine Konstante verschattet, erreicht die Datei nicht", async (context) => {
  await erwarteVerschattet(context, ["{", "  function PFAD() {}", "  await import(PFAD);", "}"]);
});

test("ausmisten-dynamisch: ein Klassenname, der eine Konstante verschattet, erreicht die Datei nicht", async (context) => {
  await erwarteVerschattet(context, ["{", "  class PFAD {}", "  await import(PFAD);", "}"]);
});

test("ausmisten-dynamisch: ein Name aus einem Zerlegungsmuster, der eine Konstante verschattet, erreicht die Datei nicht", async (context) => {
  await erwarteVerschattet(context, ["const lade = ({ PFAD }) => import(PFAD);"]);
});

test("ausmisten-dynamisch: eine Zerlegung in einem Block, die eine Konstante verschattet, erreicht die Datei nicht", async (context) => {
  await erwarteVerschattet(context, [
    "{",
    '  const { PFAD } = { PFAD: "./anders.js" };',
    "  await import(PFAD);",
    "}",
  ]);
});

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

test("ausmisten-dynamisch: zwei Stände parallel liefern je ihren eigenen Graphen und lassen das Arbeitsverzeichnis stehen", async (context) => {
  const repo = probeRepository(context, {
    "package.json": `${JSON.stringify({ type: "module" })}\n`,
    "src/eins.js": "export const eins = 1;\n",
    "src/zwei.js": "export const zwei = 2;\n",
    "test/a.test.js": 'await import("../src/eins.js");\n',
  });
  writeFiles(repo, { "test/a.test.js": 'import "../src/zwei.js";\n' });
  commitAll(repo, "Zwei");
  const vorher = cwd();
  const [alt, neu] = await Promise.all([
    graphImStand("HEAD~1", repo),
    graphImStand("HEAD", repo),
  ]);
  assert.equal(cwd(), vorher);
  assert.deepEqual(erreichendeTests("src/eins.js", alt), ["test/a.test.js"]);
  assert.deepEqual(erreichendeTests("src/zwei.js", alt), []);
  assert.deepEqual(erreichendeTests("src/zwei.js", neu), ["test/a.test.js"]);
  assert.deepEqual(erreichendeTests("src/eins.js", neu), []);
});

test("ausmisten-dynamisch: die Messmenge meldet eine geänderte Hilfsdatei ohne Testnutzer ohne zweiten Aufruf als unmessbar", async (context) => {
  const repo = probeRepository(context, {
    "package.json": `${JSON.stringify({ type: "module" })}\n`,
    "src/eins.js": "export const eins = 1;\n",
    "test/a.test.js": 'import "../src/eins.js";\n',
    "test/lose.js": "export const lose = 1;\n",
  });
  const vorher = cwd();
  chdir(repo);
  try {
    const alt = { rev: "HEAD", graph: await graphImStand("HEAD") };
    const menge = (geaendert) => messmenge({ bereich: "post", bereiche: [], geaendert, alt });
    assert.deepEqual(menge(["test/a.test.js"]).unmessbar, []);
    assert.deepEqual(menge(["test/lose.js"]).unmessbar, [
      "test/lose.js: keine Testdatei lädt oder nennt diese Datei; ihre Änderung lässt sich nicht messen",
    ]);
  } finally {
    chdir(vorher);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { befundSchluessel } from "../../tools/eslint-rules/bestand.js";
import { bestandFriertGenauEin, bestandsDatei } from "./hermes-regeln-probe.js";
import { probeDirectory } from "./probe-repo.js";
import { befundZeilen, konfigurationMitTestregeln } from "./testregeln-probe.js";

const REGEL = "hermes-tests/keine-selbstpruefung";
const BESTAND = "tools/basis/selbstpruefung.json";
const DATEI = "test/anrufe/probe.test.js";
const KOPF = [
  'import assert from "node:assert/strict";',
  'import { strict as streng, deepStrictEqual } from "node:assert";',
  'import { test } from "node:test";',
  'import { importierterWert, rufe, fuelle, andere } from "./hilfe.js";',
];
const FESTER_VERGLEICH = 'assert.equal(ERWARTET, "x");';

function befunde(verzeichnis, zeilen) {
  return befundZeilen({ verzeichnis, datei: DATEI, regel: REGEL, bestand: BESTAND }, [
    ...KOPF,
    ...zeilen,
  ]);
}

test("keine-selbstpruefung: eine Konstante des Tests gegen einen festen Wert wird gemeldet", (context) => {
  const verzeichnis = probeDirectory(context, {});
  assert.deepEqual(befunde(verzeichnis, ['const ERWARTET = "x";', FESTER_VERGLEICH]), [
    FESTER_VERGLEICH,
  ]);
});

test("keine-selbstpruefung: assert.ok(true) wird gemeldet", (context) => {
  const verzeichnis = probeDirectory(context, {});
  assert.deepEqual(befunde(verzeichnis, ["assert.ok(true);"]), ["assert.ok(true);"]);
});

test("keine-selbstpruefung: feste Ausdrücke, Literale im Aufruf und t.assert werden gemeldet", (context) => {
  const verzeichnis = probeDirectory(context, {});
  const zeilen = [
    "const GRUND = 2;",
    "const DOPPELT = GRUND * GRUND;",
    "streng.equal(DOPPELT, 4);",
    'deepStrictEqual([1, -1], [1, -1], "Meldung zählt nicht");',
    'assert.deepEqual({ wert: `fest ${"Text"}` }, { wert: "fest Text" });',
    'assert.match("Antwort", /Antwort/);',
    "assert(GRUND > 1);",
    'test("Kontext", (t) => {',
    "  t.assert.strictEqual(1 + 2, 3);",
    "});",
  ];
  assert.deepEqual(befunde(verzeichnis, zeilen), [
    "streng.equal(DOPPELT, 4);",
    'deepStrictEqual([1, -1], [1, -1], "Meldung zählt nicht");',
    'assert.deepEqual({ wert: `fest ${"Text"}` }, { wert: "fest Text" });',
    'assert.match("Antwort", /Antwort/);',
    "assert(GRUND > 1);",
    "t.assert.strictEqual(1 + 2, 3);",
  ]);
});

test("keine-selbstpruefung: Ergebnisse des Codes, Importe, let und Objekte bleiben frei", (context) => {
  const verzeichnis = probeDirectory(context, {});
  const zeilen = [
    'assert.equal(rufe(), "x");',
    "const obj = {};",
    "fuelle(obj);",
    "assert.deepEqual(obj, { a: 1 });",
    "assert.equal(importierterWert, 3);",
    "let zaehler = 1;",
    "assert.equal(zaehler, 1);",
    "const LISTE = [1];",
    "assert.deepEqual(LISTE, [1]);",
    "const ergebnis = rufe();",
    "assert.equal(ergebnis.status, 0);",
    'andere.equal("a", "a");',
    "assert.throws(() => rufe());",
    "assert.equal(undefined, undefined);",
  ];
  assert.deepEqual(befunde(verzeichnis, zeilen), []);
});

test("keine-selbstpruefung: eine eingefrorene Prüfung ist frei, dieselbe ein zweites Mal nicht", (context) => {
  const verzeichnis = probeDirectory(context, {
    [BESTAND]: bestandsDatei([befundSchluessel(DATEI, FESTER_VERGLEICH.slice(0, -1))]),
  });
  const zeilen = ['const ERWARTET = "x";', FESTER_VERGLEICH];
  assert.deepEqual(befunde(verzeichnis, zeilen), []);
  assert.deepEqual(befunde(verzeichnis, [...zeilen, FESTER_VERGLEICH]), [FESTER_VERGLEICH]);
  assert.deepEqual(befunde(verzeichnis, ["assert.ok(true);"]), ["assert.ok(true);"]);
});

test("keine-selbstpruefung: die Basislinie aus basis-vergleich friert genau den Bestand ein", (context) => {
  bestandFriertGenauEin(context, {
    werkzeug: "selbstpruefung",
    konfiguration: { files: ["test/**"], rules: { [REGEL]: ["error", { bestand: BESTAND }] } },
    vorher: {
      "eslint.config.mjs": konfigurationMitTestregeln(REGEL, BESTAND),
      "test/alt.test.js": `${KOPF.join("\n")}\nassert.ok(true);\n`,
    },
    neu: { "test/neu.test.js": `${KOPF.join("\n")}\nassert.equal(1, 1);\n` },
    ort: "test/neu.test.js:5",
  });
});

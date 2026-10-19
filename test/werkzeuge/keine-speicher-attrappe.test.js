import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { befundSchluessel } from "../../tools/eslint-rules/bestand.js";
import { bestandFriertGenauEin, bestandsDatei } from "./hermes-regeln-probe.js";
import { ESLINT_BIN, REPO_ROOT, probeDirectory, runIn, writeFiles } from "./probe-repo.js";
import { befundZeilen, konfigurationMitTestregeln } from "./testregeln-probe.js";

const REGEL = "hermes-tests/keine-speicher-attrappe";
const WERKZEUG = "keine-speicher-attrappe";
const BESTAND = "tools/basis/keine-speicher-attrappe.json";
const DATEI = "test/anrufe/probe.test.js";
const ECHTE_SPERRE_DATEI = "test/pg-helpers.js";
const ATTRAPPE = "speicher = { withStoreLock: (fn) => fn() };";
const ECHTE_SPERRE = "store.withStoreLock = macheSpeicherSperre();";
const SPERRE_IMPORT = 'import { macheSpeicherSperre } from "../src/store/pg.js";';
const BASIS_VERGLEICH = join(REPO_ROOT, "tools/basis-vergleich.mjs");
const EXIT_OK = 0;

function befunde(verzeichnis, zeilen, datei = DATEI) {
  return befundZeilen({ verzeichnis, datei, regel: REGEL, bestand: BESTAND }, zeilen);
}

function knoten(verzeichnis, programm, args) {
  const lauf = runIn(verzeichnis, process.execPath, [programm, ...args]);
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

test("keine-speicher-attrappe: withStoreLock als Eigenschaft, Methode, Klassenglied, Zuweisung oder Name im Aufruf wird gemeldet", (context) => {
  const verzeichnis = probeDirectory(context, {});
  const zeilen = [
    ATTRAPPE,
    "const mitSpread = { ...basis, withStoreLock: async (fn) => fn() };",
    "const methode = { withStoreLock(fn) { return fn(); } };",
    'const berechnet = { ["withStoreLock"]: (fn) => fn() };',
    "const vorlage = { [`withStoreLock`]: (fn) => fn() };",
    'const inAnfuehrung = { "withStoreLock": (fn) => fn() };',
    "const kurz = { withStoreLock };",
    "class Methode { withStoreLock(fn) { return fn(); } }",
    "class Feld { withStoreLock = (fn) => fn(); }",
    "store.withStoreLock = (fn) => fn();",
    'store["withStoreLock"] = (fn) => fn();',
    'context.mock.method(store, "withStoreLock", (fn) => fn());',
    'Object.defineProperty(store, "withStoreLock", { value: (fn) => fn() });',
  ];
  assert.deepEqual(befunde(verzeichnis, zeilen), zeilen);
});

test("keine-speicher-attrappe: Aufrufen, Lesen und Zerlegen der echten Sperre bleiben frei", (context) => {
  const verzeichnis = probeDirectory(context, {});
  const zeilen = [
    "await store.withStoreLock(() => store.save());",
    "const { withStoreLock } = store;",
    "const sperre = store.withStoreLock;",
    'assert.equal(typeof store.withStoreLock, "function");',
    'test("withStoreLock sperrt den zweiten Abschnitt", () => {});',
  ];
  assert.deepEqual(befunde(verzeichnis, zeilen), []);
});

test("keine-speicher-attrappe: nur test/pg-helpers.js darf die echte Sperre zuweisen, eine Attrappe dort bleibt rot", (context) => {
  const verzeichnis = probeDirectory(context, {});
  const attrappen = ["store.withStoreLock = (fn) => fn();", ATTRAPPE];
  assert.deepEqual(
    befunde(verzeichnis, [SPERRE_IMPORT, ECHTE_SPERRE, ...attrappen], ECHTE_SPERRE_DATEI),
    attrappen,
  );
  assert.deepEqual(befunde(verzeichnis, [SPERRE_IMPORT, ECHTE_SPERRE]), [ECHTE_SPERRE]);
});

test("keine-speicher-attrappe: eine eigene macheSpeicherSperre in test/pg-helpers.js ist keine echte Sperre", (context) => {
  const verzeichnis = probeDirectory(context, {});
  const eigene = "const macheSpeicherSperre = () => (fn) => fn();";
  const fremderImport = 'import { macheSpeicherSperre } from "./attrappe.js";';
  assert.deepEqual(befunde(verzeichnis, [eigene, ECHTE_SPERRE], ECHTE_SPERRE_DATEI), [
    ECHTE_SPERRE,
  ]);
  assert.deepEqual(befunde(verzeichnis, [fremderImport, ECHTE_SPERRE], ECHTE_SPERRE_DATEI), [
    ECHTE_SPERRE,
  ]);
  assert.deepEqual(befunde(verzeichnis, [ECHTE_SPERRE], ECHTE_SPERRE_DATEI), [ECHTE_SPERRE]);
});

test("keine-speicher-attrappe: eine eingefrorene Attrappe ist frei, dieselbe ein zweites Mal und eine andere in derselben Datei nicht", (context) => {
  const eigenschaft = "withStoreLock: (fn) => fn()";
  const andere = "const zweiter = { withStoreLock: async (fn) => fn() };";
  const verzeichnis = probeDirectory(context, {
    [BESTAND]: bestandsDatei([befundSchluessel(DATEI, eigenschaft)]),
  });
  assert.deepEqual(befunde(verzeichnis, [ATTRAPPE]), []);
  assert.deepEqual(befunde(verzeichnis, [ATTRAPPE, ATTRAPPE]), [ATTRAPPE]);
  assert.deepEqual(befunde(verzeichnis, [ATTRAPPE, andere]), [andere]);
});

test("keine-speicher-attrappe: die Basislinie aus basis-vergleich friert genau den Bestand ein", (context) => {
  bestandFriertGenauEin(context, {
    werkzeug: WERKZEUG,
    konfiguration: { files: ["test/**"], rules: { [REGEL]: ["error", { bestand: BESTAND }] } },
    vorher: {
      "eslint.config.mjs": konfigurationMitTestregeln(REGEL, BESTAND),
      "test/alt.test.js": `${ATTRAPPE}\n`,
    },
    neu: { "test/neu.test.js": "\nstore.withStoreLock = (fn) => fn();\n" },
    ort: "test/neu.test.js:2",
  });
});

test("keine-speicher-attrappe: eine entfernte Altstelle hält Lint grün, und basis-vergleich verlangt die kürzere Liste", (context) => {
  const verzeichnis = probeDirectory(context, {
    "eslint.config.mjs": konfigurationMitTestregeln(REGEL, BESTAND),
    "test/alt.test.js": `${ATTRAPPE}\nstore.withStoreLock = (fn) => fn();\n`,
  });
  assert.equal(knoten(verzeichnis, BASIS_VERGLEICH, [WERKZEUG, "--basis-anlegen"]).status, EXIT_OK);
  writeFiles(verzeichnis, { "test/alt.test.js": `${ATTRAPPE}\n` });
  const lint = knoten(verzeichnis, ESLINT_BIN, ["."]);
  assert.equal(lint.status, EXIT_OK, lint.ausgabe);
  const vergleich = knoten(verzeichnis, BASIS_VERGLEICH, [WERKZEUG]);
  assert.equal(vergleich.status, EXIT_OK, vergleich.ausgabe);
  assert.match(
    vergleich.ausgabe,
    /1 Befunde aus tools\/basis\/keine-speicher-attrappe\.json sind behoben/,
  );
  assert.match(vergleich.ausgabe, /Die Basislinie kann kürzer werden/);
});

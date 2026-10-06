import assert from "node:assert/strict";
import { test } from "node:test";

import { befundSchluessel } from "../../tools/eslint-rules/bestand.js";
import { bestandFriertGenauEin, bestandsDatei, gemeldeteZeilen } from "./hermes-regeln-probe.js";
import { probeDirectory } from "./probe-repo.js";

const RULE = "hermes/kein-quelltext-als-text";
const BESTAND = "tools/basis/quelltext-als-text.json";
const DATEI = "test/probe.test.js";
const KOPF = [
  'import fs, { readFileSync, readdirSync, mkdtempSync } from "node:fs";',
  'import { readFile } from "node:fs/promises";',
  'import path, { join } from "node:path";',
  'import { tmpdir } from "node:os";',
  'import { fileURLToPath } from "node:url";',
  'import { ROOT } from "./helpers.js";',
];

function gemeldet(directory, zeilen) {
  const regel = { directory, datei: DATEI, regel: RULE, bestand: BESTAND };
  return gemeldeteZeilen(regel, [...KOPF, ...zeilen]);
}

function ohneBestand(context) {
  return probeDirectory(context, {});
}

const LESEN_UEBER_URL = 'const text = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");';
const LESEN_UEBER_WURZEL = 'const quelle = readFileSync(join(ROOT, "src", "config.js"), "utf8");';

test("kein-quelltext-als-text: ein Test, der eine Datei unter src/ liest, wird gemeldet", (context) => {
  const directory = ohneBestand(context);
  const zeilen = [
    LESEN_UEBER_URL,
    LESEN_UEBER_WURZEL,
    'const WURZEL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");',
    'fs.readFileSync(path.resolve(WURZEL, "src/boot.js"));',
    'await fs.promises.readFile(`${WURZEL}/src/app.js`);',
    'await readFile(path.join(process.cwd(), "src") + "/voice.js");',
  ];
  assert.deepEqual(gemeldet(directory, zeilen), [
    LESEN_UEBER_URL,
    LESEN_UEBER_WURZEL,
    'fs.readFileSync(path.resolve(WURZEL, "src/boot.js"));',
    'await fs.promises.readFile(`${WURZEL}/src/app.js`);',
    'await readFile(path.join(process.cwd(), "src") + "/voice.js");',
  ]);
});

test("kein-quelltext-als-text: Hilfsfunktion, Liste und Verzeichnisdurchlauf werden aufgelöst", (context) => {
  const directory = ohneBestand(context);
  const hilfsfunktion = 'const lies = (relativ) => readFileSync(join(ROOT, relativ), "utf8");';
  const schleife = 'for (const datei of DATEIEN) fs.readFileSync(join(ROOT, "src", datei));';
  const durchlauf = "for (const eintrag of readdirSync(ordner)) liste.push(join(ordner, eintrag));";
  const gelesen = "const inhalte = alle(join(ROOT, \"src\")).map((datei) => readFileSync(datei));";
  const zeilen = [
    hilfsfunktion,
    'lies("src/mcp-tools.js");',
    'const DATEIEN = ["server.js", "boot.js"];',
    schleife,
    "function alle(ordner) {",
    "  const liste = [];",
    durchlauf,
    "  return liste;",
    "}",
    gelesen,
  ];
  assert.deepEqual(gemeldet(directory, zeilen), [hilfsfunktion, schleife, durchlauf, gelesen]);
});

test("kein-quelltext-als-text: Markdown und docs/ werden gemeldet", (context) => {
  const directory = ohneBestand(context);
  const lehren = 'readFileSync(join(ROOT, "tasks/lessons.md"), "utf8");';
  const doku = 'readFileSync(new URL("../docs/mcp-vertrag.json", import.meta.url));';
  assert.deepEqual(gemeldet(directory, [lehren, doku]), [lehren, doku]);
});

test("kein-quelltext-als-text: apps/web/src, Temp-Ordner, Fixtures und Unbekanntes bleiben frei", (context) => {
  const directory = ohneBestand(context);
  const zeilen = [
    'readFileSync(join(ROOT, "apps/web/src/pages/index.astro"), "utf8");',
    'const temp = mkdtempSync(join(tmpdir(), "probe-"));',
    'readFileSync(join(temp, "src", "eins.js"), "utf8");',
    'readFileSync(join(ROOT, "test/fixtures/beispiel.md"), "utf8");',
    'readFileSync(new URL("./fixtures/antwort.json", import.meta.url));',
    "readFileSync(process.argv[2]);",
    'readFileSync(join(ROOT, "package.json"), "utf8");',
    'const anderes = { readFileSync: () => "" };',
    'anderes.readFileSync(join(ROOT, "src/server.js"));',
  ];
  assert.deepEqual(gemeldet(directory, zeilen), []);
});

test("kein-quelltext-als-text: eine eingefrorene Lesestelle ist frei, dieselbe ein zweites Mal nicht", (context) => {
  const aufruf = LESEN_UEBER_URL.slice("const text = ".length, -1);
  const directory = probeDirectory(context, {
    [BESTAND]: bestandsDatei([befundSchluessel(DATEI, aufruf)]),
  });
  assert.deepEqual(gemeldet(directory, [LESEN_UEBER_URL]), []);
  const zweites = 'const zweiter = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");';
  assert.deepEqual(gemeldet(directory, [LESEN_UEBER_URL, zweites]), [zweites]);
  assert.deepEqual(gemeldet(directory, [LESEN_UEBER_WURZEL]), [LESEN_UEBER_WURZEL]);
});

test("kein-quelltext-als-text: die Basislinie aus basis-vergleich friert genau den Bestand ein", (context) => {
  bestandFriertGenauEin(context, {
    werkzeug: "quelltext-als-text",
    konfiguration: { files: ["test/**"], rules: { [RULE]: ["error", { bestand: BESTAND }] } },
    vorher: { "test/alt.test.js": `${KOPF.join("\n")}\n${LESEN_UEBER_URL}\n` },
    neu: { "test/neu.test.js": `${KOPF.join("\n")}\n${LESEN_UEBER_WURZEL}\n` },
    ort: "test/neu.test.js:7",
  });
});

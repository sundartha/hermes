import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { Linter } from "eslint";

import { befundSchluessel } from "../../tools/eslint-rules/bestand.js";
import hermes from "../../tools/eslint-rules/index.js";
import { ESLINT_BIN, REPO_ROOT, isolatedEnvironment, probeDirectory, writeFiles } from "./probe-repo.js";

const RULE = "hermes/kein-quelltext-als-text";
const BESTAND = "tools/basis/quelltext-als-text.json";
const DATEI = "test/probe.test.js";
const JSON_INDENT = 2;
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const BASIS_VERGLEICH = join(REPO_ROOT, "tools/basis-vergleich.mjs");
const PLUGIN_URL = pathToFileURL(join(REPO_ROOT, "tools/eslint-rules/index.js")).href;
const KOPF = [
  'import fs, { readFileSync, readdirSync, mkdtempSync } from "node:fs";',
  'import { readFile } from "node:fs/promises";',
  'import path, { join } from "node:path";',
  'import { tmpdir } from "node:os";',
  'import { fileURLToPath } from "node:url";',
  'import { ROOT } from "./helpers.js";',
];

function gemeldet(directory, zeilen) {
  const linter = new Linter({ cwd: directory });
  const config = {
    plugins: { hermes },
    rules: { [RULE]: ["error", { bestand: BESTAND }] },
  };
  const quelltext = [...KOPF, ...zeilen].join("\n");
  const messages = linter.verify(quelltext, config, { filename: join(directory, DATEI) });
  const zeilenText = quelltext.split("\n");
  return messages
    .filter(({ ruleId }) => ruleId === RULE)
    .map(({ line }) => zeilenText[line - 1].trim());
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
    [BESTAND]: `${JSON.stringify({ befunde: [befundSchluessel(DATEI, aufruf)] }, null, JSON_INDENT)}\n`,
  });
  assert.deepEqual(gemeldet(directory, [LESEN_UEBER_URL]), []);
  const zweites = 'const zweiter = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");';
  assert.deepEqual(gemeldet(directory, [LESEN_UEBER_URL, zweites]), [zweites]);
  assert.deepEqual(gemeldet(directory, [LESEN_UEBER_WURZEL]), [LESEN_UEBER_WURZEL]);
});

function eslintKonfiguration() {
  const regel = `${JSON.stringify(RULE)}: ["error", { bestand: ${JSON.stringify(BESTAND)} }]`;
  return [
    `import hermes from ${JSON.stringify(PLUGIN_URL)};`,
    `export default [{ files: ["test/**"], plugins: { hermes }, rules: { ${regel} } }];`,
    "",
  ].join("\n");
}

function laufen(directory, programm, args) {
  const run = spawnSync(process.execPath, [programm, ...args], {
    cwd: directory,
    encoding: "utf8",
    env: isolatedEnvironment(),
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

test("kein-quelltext-als-text: die Basislinie aus basis-vergleich friert genau den Bestand ein", (context) => {
  const directory = probeDirectory(context, {
    "eslint.config.mjs": eslintKonfiguration(),
    "test/alt.test.js": `${KOPF.join("\n")}\n${LESEN_UEBER_URL}\n`,
  });
  const angelegt = laufen(directory, BASIS_VERGLEICH, ["quelltext-als-text", "--basis-anlegen"]);
  assert.equal(angelegt.status, EXIT_OK, angelegt.output);
  assert.match(angelegt.output, /mit 1 Befunden angelegt/);
  assert.equal(laufen(directory, ESLINT_BIN, ["."]).status, EXIT_OK);
  writeFiles(directory, { "test/neu.test.js": `${KOPF.join("\n")}\n${LESEN_UEBER_WURZEL}\n` });
  const lint = laufen(directory, ESLINT_BIN, ["."]);
  assert.equal(lint.status, EXIT_FINDING, lint.output);
  assert.match(lint.output, new RegExp(`test/neu\\.test\\.js[\\s\\S]*${RULE}`));
  const vergleich = laufen(directory, BASIS_VERGLEICH, ["quelltext-als-text"]);
  assert.equal(vergleich.status, EXIT_FINDING, vergleich.output);
  assert.match(vergleich.output, /test\/neu\.test\.js:7/);
});

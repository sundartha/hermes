import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { Linter } from "eslint";

import { befundSchluessel } from "../../tools/eslint-rules/bestand.js";
import hermes from "../../tools/eslint-rules/index.js";
import { ESLINT_BIN, REPO_ROOT, isolatedEnvironment, probeDirectory, writeFiles } from "./probe-repo.js";

const RULE = "hermes/keine-kommentare";
const BESTAND = "tools/basis/kommentare.json";
const DATEI = "src/beispiel.js";
const ALTER_KOMMENTAR = "// alter Kommentar";
const CODE = "export const wert = true;";
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const JSON_INDENT = 2;
const BASIS_VERGLEICH = join(REPO_ROOT, "tools/basis-vergleich.mjs");
const PLUGIN_URL = pathToFileURL(join(REPO_ROOT, "tools/eslint-rules/index.js")).href;

function bestandsDatei(befunde) {
  return `${JSON.stringify({ befunde }, null, JSON_INDENT)}\n`;
}

function verzeichnisMitBestand(context, schluessel) {
  return probeDirectory(context, { [BESTAND]: bestandsDatei(schluessel) });
}

function gemeldeteZeilen(directory, zeilen, { noInlineConfig = true } = {}) {
  const linter = new Linter({ cwd: directory });
  const config = {
    plugins: { hermes },
    linterOptions: { noInlineConfig },
    rules: { [RULE]: ["error", { bestand: BESTAND }] },
  };
  const messages = linter.verify(zeilen.join("\n"), config, {
    filename: join(directory, DATEI),
  });
  return messages.filter(({ ruleId }) => ruleId === RULE).map(({ line }) => zeilen[line - 1]);
}

function eingefroren(context, ...texte) {
  return verzeichnisMitBestand(
    context,
    texte.map((text) => befundSchluessel(DATEI, text)),
  );
}

test("keine-kommentare: ein Kommentar in einer neuen Datei wird gemeldet", (context) => {
  const directory = verzeichnisMitBestand(context, []);
  const kommentare = ["// neu", "/* auch neu */", "/** JSDoc */"];
  assert.deepEqual(gemeldeteZeilen(directory, [CODE, ...kommentare]), kommentare);
});

test("keine-kommentare: ein eingefrorener Kommentar wird nicht gemeldet, auch nach Verschieben", (context) => {
  const directory = eingefroren(context, " alter Kommentar");
  assert.deepEqual(gemeldeteZeilen(directory, [ALTER_KOMMENTAR, CODE]), []);
  assert.deepEqual(gemeldeteZeilen(directory, [CODE, "", ALTER_KOMMENTAR]), []);
});

test("keine-kommentare: derselbe Text ein zweites Mal wird gemeldet", (context) => {
  const directory = eingefroren(context, " alter Kommentar");
  const zeilen = [ALTER_KOMMENTAR, CODE, ALTER_KOMMENTAR];
  assert.deepEqual(gemeldeteZeilen(directory, zeilen), [ALTER_KOMMENTAR]);
});

test("keine-kommentare: ein geänderter Text wird gemeldet, anderer Leerraum nicht", (context) => {
  const directory = eingefroren(context, " alter Kommentar");
  const geaendert = "// alter Kommentar, erweitert";
  assert.deepEqual(gemeldeteZeilen(directory, [geaendert, CODE]), [geaendert]);
  assert.deepEqual(gemeldeteZeilen(directory, ["//   alter    Kommentar  ", CODE]), []);
});

test("keine-kommentare: ein eingefrorener Kommentar gilt nur in seiner eigenen Datei", (context) => {
  const directory = verzeichnisMitBestand(context, [
    befundSchluessel("src/andere.js", " alter Kommentar"),
  ]);
  assert.deepEqual(gemeldeteZeilen(directory, [ALTER_KOMMENTAR, CODE]), [ALTER_KOMMENTAR]);
});

test("keine-kommentare: jede andere Startzeile als #!/usr/bin/env node wird gemeldet", (context) => {
  const directory = verzeichnisMitBestand(context, []);
  for (const startzeile of ["#!/usr/bin/node", "#!/usr/bin/env node --weil-es-schneller-ist", "#!/usr/bin/env  node"]) {
    assert.deepEqual(gemeldeteZeilen(directory, [startzeile, CODE]), [startzeile]);
  }
});

test("keine-kommentare: eine eingefrorene andere Startzeile ist frei", (context) => {
  const directory = eingefroren(context, "/usr/bin/node");
  assert.deepEqual(gemeldeteZeilen(directory, ["#!/usr/bin/node", CODE]), []);
});

test("keine-kommentare: die Startzeile #!/usr/bin/env node ist kein Kommentar", (context) => {
  const directory = verzeichnisMitBestand(context, []);
  assert.deepEqual(gemeldeteZeilen(directory, ["#!/usr/bin/env node", CODE]), []);
});

test("keine-kommentare: ein Abschaltkommentar für die Regel wird selbst gemeldet", (context) => {
  const directory = verzeichnisMitBestand(context, []);
  const abschaltung = `// eslint-disable-next-line ${RULE}`;
  const dahinter = "// dahinter";
  assert.deepEqual(gemeldeteZeilen(directory, [abschaltung, dahinter, CODE]), [
    abschaltung,
    dahinter,
  ]);
  const blockweise = `/* eslint-disable ${RULE} */`;
  assert.deepEqual(gemeldeteZeilen(directory, [blockweise, CODE]), [blockweise]);
});

const DIREKTIVE_OBEN = '"weil es so sein muss";';

test("keine-kommentare: eine Direktive mit Text wird gemeldet, \"use strict\" nicht", (context) => {
  const directory = verzeichnisMitBestand(context, []);
  const innen = '"auch hier eine Begründung";';
  const zeilen = ['"use strict";', DIREKTIVE_OBEN, "export function f() {", "'use strict';", innen, "return 1;", "}"];
  assert.deepEqual(gemeldeteZeilen(directory, zeilen), [DIREKTIVE_OBEN, innen]);
});

test("keine-kommentare: eine eingefrorene Direktive ist frei, dieselbe ein zweites Mal nicht", (context) => {
  const directory = eingefroren(context, "weil es so sein muss");
  assert.deepEqual(gemeldeteZeilen(directory, [DIREKTIVE_OBEN, CODE]), []);
  const zweimal = [DIREKTIVE_OBEN, "export function f() {", DIREKTIVE_OBEN, "return 1;", "}"];
  assert.deepEqual(gemeldeteZeilen(directory, zweimal), [DIREKTIVE_OBEN]);
});

test("keine-kommentare: ohne Bestandsdatei ist jeder Kommentar neu", (context) => {
  const directory = probeDirectory(context, {});
  assert.deepEqual(gemeldeteZeilen(directory, [ALTER_KOMMENTAR, CODE]), [ALTER_KOMMENTAR]);
});

function eslintKonfiguration() {
  return [
    `import hermes from ${JSON.stringify(PLUGIN_URL)};`,
    "export default [",
    `  { plugins: { hermes }, linterOptions: { noInlineConfig: true }, rules: { ${JSON.stringify(RULE)}: ["error", { bestand: ${JSON.stringify(BESTAND)} }] } },`,
    "];",
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

test("keine-kommentare: die Basislinie aus basis-vergleich friert genau den Bestand ein", (context) => {
  const directory = probeDirectory(context, {
    "eslint.config.mjs": eslintKonfiguration(),
    "src/alt.js": `${ALTER_KOMMENTAR}\n${CODE}\n`,
  });
  const angelegt = laufen(directory, BASIS_VERGLEICH, ["kommentare", "--basis-anlegen"]);
  assert.equal(angelegt.status, EXIT_OK, angelegt.output);
  assert.match(angelegt.output, /mit 1 Befunden angelegt/);
  assert.equal(laufen(directory, ESLINT_BIN, ["."]).status, EXIT_OK);
  writeFiles(directory, { "src/neu.js": `${CODE}\n// neuer Kommentar\n` });
  const lint = laufen(directory, ESLINT_BIN, ["."]);
  assert.equal(lint.status, EXIT_FINDING, lint.output);
  assert.match(lint.output, new RegExp(`src/neu\\.js[\\s\\S]*2:1[\\s\\S]*${RULE}`));
  const vergleich = laufen(directory, BASIS_VERGLEICH, ["kommentare"]);
  assert.equal(vergleich.status, EXIT_FINDING, vergleich.output);
  assert.match(vergleich.output, /src\/neu\.js:2/);
});

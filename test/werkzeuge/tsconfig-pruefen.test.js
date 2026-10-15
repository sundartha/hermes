import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, probeDirectory, runIn, writeFiles } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/tsconfig-pruefen.mjs");
const WRITE_OPTION = "--basis-schreiben";
const EXIT_GREEN = 0;
const EXIT_RED = 1;

function tsconfig(compilerOptions, rest = {}) {
  const options = { noEmit: true, allowJs: true, checkJs: false, strict: true, ...compilerOptions };
  return `${JSON.stringify({ compilerOptions: options, include: ["src"], ...rest })}\n`;
}

const PROJECT_FILES = {
  "tsconfig.json": tsconfig({}),
  "src/a.js": "export const a = 1;\n",
  "tools/basis/.keep": "",
};

function run(directory, args = []) {
  const result = runIn(directory, process.execPath, [TOOL, ...args, directory]);
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function checkAfterChange(context, after, before = {}) {
  const directory = probeDirectory(context, { ...PROJECT_FILES, ...before });
  const written = run(directory, [WRITE_OPTION]);
  assert.equal(written.status, EXIT_GREEN, written.output);
  writeFiles(directory, after);
  return run(directory);
}

test("tsconfig-pruefen: unveränderte tsconfig.json endet grün ohne Ausgabe", (context) => {
  const result = checkAfterChange(context, {});
  assert.equal(result.status, EXIT_GREEN, result.output);
  assert.equal(result.output, "");
});

test("tsconfig-pruefen: eine neue Quelldatei nach der Kopie bleibt grün", (context) => {
  const result = checkAfterChange(context, { "src/neu.js": "export const neu = 2;\n" });
  assert.deepEqual(result, { status: EXIT_GREEN, output: "" });
});

test("tsconfig-pruefen: eine andere Reihenfolge der Schlüssel in paths bleibt grün", (context) => {
  const paths = (keys) => Object.fromEntries(keys.map((key) => [`#${key}/*`, [`./src/${key}/*`]]));
  const result = checkAfterChange(
    context,
    { "tsconfig.json": tsconfig({ paths: paths(["b", "a"]) }) },
    { "tsconfig.json": tsconfig({ paths: paths(["a", "b"]) }) },
  );
  assert.deepEqual(result, { status: EXIT_GREEN, output: "" });
});

test("tsconfig-pruefen: strict auf false macht rot und nennt die Option mit beiden Werten", (context) => {
  const result = checkAfterChange(context, { "tsconfig.json": tsconfig({ strict: false }) });
  assert.equal(result.status, EXIT_RED, result.output);
  assert.match(
    result.output,
    /^tsconfig\.json: compilerOptions\.strict ist false, die Kopie sagt true$/m,
  );
  assert.match(result.output, /--basis-schreiben/);
});

test("tsconfig-pruefen: ein ausgeschlossener Ordner macht rot", (context) => {
  const result = checkAfterChange(context, {
    "tsconfig.json": tsconfig({}, { exclude: ["src/telephony"] }),
  });
  assert.equal(result.status, EXIT_RED, result.output);
  assert.match(
    result.output,
    /^tsconfig\.json: exclude ist \["src\/telephony"\], die Kopie sagt nicht gesetzt$/m,
  );
});

test("tsconfig-pruefen: eine abgeschaltete Einzeloption unter strict macht rot", (context) => {
  const result = checkAfterChange(context, {
    "tsconfig.json": tsconfig({ strictNullChecks: false }),
  });
  assert.equal(result.status, EXIT_RED, result.output);
  assert.match(
    result.output,
    /compilerOptions\.strictNullChecks ist false, die Kopie sagt nicht gesetzt/,
  );
});

test("tsconfig-pruefen: ohne Kopie endet die Prüfung rot", (context) => {
  const directory = probeDirectory(context, PROJECT_FILES);
  const result = run(directory);
  assert.equal(result.status, EXIT_RED, result.output);
  assert.match(result.output, /tools\/basis\/tsconfig-wirksam\.json fehlt/);
});

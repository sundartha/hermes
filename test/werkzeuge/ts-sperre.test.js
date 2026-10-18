import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/ts-sperre.mjs");
const STOCK_FILE = "tools/basis/ts-bestand.json";
const EXIT_GREEN = 0;
const EXIT_RED = 1;
const STOCK_PATH = "apps/alt/main.ts";
const NEW_PATH = "apps/web/c.ts";

function stock(paths) {
  return `${JSON.stringify(paths)}\n`;
}

const ESLINT_CONFIG = 'export default [{ files: ["{src,test,tools,scripts}/**/*.{ts,mts,cts}"] }, { ignores: ["**/out/**"] }];\n';
const TSCONFIG = (include) => `${JSON.stringify({ compilerOptions: { allowJs: true, noEmit: true }, include })}\n`;
const ALL_ROOTS = ["src", "test", "tools", "scripts"];

const BASE_FILES = {
  "README.md": "Probe\n",
  "eslint.config.js": ESLINT_CONFIG,
  "tsconfig.json": TSCONFIG(ALL_ROOTS),
  [STOCK_PATH]: "export const alt = 1;\n",
  [STOCK_FILE]: stock([STOCK_PATH]),
};

function run(repo, args = []) {
  const result = runIn(repo, process.execPath, [TOOL, ...args]);
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function runLockInNewRepo(context, files) {
  return run(probeRepository(context, { ...BASE_FILES, ...files }));
}

test("ts-sperre: JavaScript und die TypeScript-Dateien aus dem Bestand enden grün", (context) => {
  const result = runLockInNewRepo(context, {
    "src/a.js": "export const a = 1;\n",
    "tools/b.mjs": "export const b = 1;\n",
  });
  assert.equal(result.status, EXIT_GREEN, result.output);
  assert.equal(result.output, "");
});

test("ts-sperre: .ts, .mts und .cts klein geschrieben unter src, test, tools und scripts enden grün", (context) => {
  for (const path of [
    "src/neu.ts",
    "test/neu.test.ts",
    "tools/neu.mts",
    "scripts/neu.cts",
    "src/typen.d.ts",
  ]) {
    const result = runLockInNewRepo(context, { [path]: "export const neu = 1;\n" });
    assert.equal(result.status, EXIT_GREEN, `${path}: ${result.output}`);
    assert.equal(result.output, "");
  }
});

test("ts-sperre: jede TypeScript-Datei, die ESLint, tsc oder der Testläufer nicht sehen, macht rot, in jedem Ordner und jeder Schreibweise", (context) => {
  const outsidePlace = "TypeScript-Datei, die ESLint oder tsc nicht prüfen";
  for (const [path, reason] of [
    [NEW_PATH, outsidePlace],
    ["lib/neu.ts", outsidePlace],
    ["design-system/neu.tsx", outsidePlace],
    ["src/neu.tsx", outsidePlace],
    ["src/gross.TS", outsidePlace],
    ["tools/gross.Mts", outsidePlace],
    ["neu.d.ts", outsidePlace],
    ["src/out/neu.ts", "TypeScript-Datei, die ESLint nicht prüft"],
    ["test/neu.test.mts", "TypeScript-Testdatei, die der Testläufer nicht startet"],
    ["test/neu.test.cts", "TypeScript-Testdatei, die der Testläufer nicht startet"],
  ]) {
    const result = runLockInNewRepo(context, { [path]: "export const neu = 1;\n" });
    assert.equal(result.status, EXIT_RED, result.output);
    assert.ok(result.output.startsWith(`${path}: ${reason}`), result.output);
    assert.match(result.output, /^Ausweg: /m);
  }
});

test("ts-sperre: eine .ts-Datei, die tsconfig.json nicht enthält, macht rot", (context) => {
  const result = runLockInNewRepo(context, {
    "tsconfig.json": TSCONFIG(["src", "test", "scripts"]),
    "tools/neu.mts": "export const neu = 1;\n",
  });
  assert.equal(result.status, EXIT_RED, result.output);
  assert.ok(result.output.startsWith("tools/neu.mts: TypeScript-Datei, die tsc nicht prüft"), result.output);
});

test("ts-sperre: ohne lesbare tsconfig.json macht jede .ts-Datei rot und nennt sie", (context) => {
  const withoutTsconfig = Object.fromEntries(Object.entries(BASE_FILES).filter(([path]) => path !== "tsconfig.json"));
  const result = run(probeRepository(context, { ...withoutTsconfig, "src/neu.ts": "export const neu = 1;\n" }));
  assert.equal(result.status, EXIT_RED, result.output);
  assert.ok(result.output.startsWith("src/neu.ts: TypeScript-Datei, bei der sich nicht feststellen lässt, ob tsc sie prüft"), result.output);
});

test("ts-sperre: ohne ladbare ESLint-Konfiguration macht jede .ts-Datei rot", (context) => {
  const result = runLockInNewRepo(context, { "eslint.config.js": "export default [;\n", "src/neu.ts": "export const neu = 1;\n" });
  assert.equal(result.status, EXIT_RED, result.output);
  assert.ok(result.output.startsWith("src/neu.ts: TypeScript-Datei, bei der sich nicht feststellen lässt, ob ESLint sie prüft"), result.output);
});

test("ts-sperre: ein Eintrag unter src, test, tools oder scripts im Bestand macht rot", (context) => {
  for (const path of ["src/neu.ts", "test/neu.ts", "tools/neu.ts", "scripts/neu.ts"]) {
    const result = runLockInNewRepo(context, {
      [path]: "export const neu = 1;\n",
      [STOCK_FILE]: stock([STOCK_PATH, path]),
    });
    assert.equal(result.status, EXIT_RED, result.output);
    const named = `${STOCK_FILE}: ${path} liegt unter src/, test/, tools/ oder scripts/ und darf`;
    assert.ok(result.output.startsWith(named), result.output);
  }
});

test("ts-sperre: ohne Bestand an der Basis darf er nur die dort versionierten TypeScript-Dateien nennen", (context) => {
  const withoutStock = Object.entries(BASE_FILES).filter(([path]) => path !== STOCK_FILE);
  const repo = probeRepository(context, Object.fromEntries(withoutStock));
  writeFiles(repo, { [STOCK_FILE]: stock([STOCK_PATH]) });
  commitAll(repo, "Bestand angelegt");
  const first = run(repo, ["--basis", "HEAD~1"]);
  writeFiles(repo, {
    [NEW_PATH]: "export const c = 1;\n",
    [STOCK_FILE]: stock([STOCK_PATH, NEW_PATH]),
  });
  commitAll(repo, "Bestand mit neuer Datei angelegt");
  const grown = run(repo, ["--basis", "HEAD~2"]);
  assert.equal(first.status, EXIT_GREEN, first.output);
  assert.equal(grown.status, EXIT_RED, grown.output);
  assert.match(grown.output, /apps\/web\/c\.ts ist neu im Bestand/);
});

test("ts-sperre: ein gegenüber der Basis gewachsener Bestand macht mit --basis rot, ein gekürzter nicht", (context) => {
  const repo = probeRepository(context, BASE_FILES);
  writeFiles(repo, {
    [NEW_PATH]: "export const c = 1;\n",
    [STOCK_FILE]: stock([STOCK_PATH, NEW_PATH]),
  });
  commitAll(repo, "Bestand gewachsen");
  const grown = run(repo, ["--basis", "HEAD~1"]);
  assert.equal(grown.status, EXIT_RED, grown.output);
  assert.match(grown.output, /apps\/web\/c\.ts ist neu im Bestand/);
  for (const path of [STOCK_PATH, NEW_PATH]) rmSync(join(repo, path));
  writeFiles(repo, { [STOCK_FILE]: stock([]) });
  commitAll(repo, "Bestand gekürzt");
  const shrunk = run(repo, ["--basis", "HEAD~2"]);
  assert.equal(shrunk.status, EXIT_GREEN, shrunk.output);
});

test("ts-sperre: --basis ohne lesbaren Commit macht rot", (context) => {
  const repo = probeRepository(context, BASE_FILES);
  for (const basis of ["", "gibt-es-nicht"]) {
    const result = run(repo, ["--basis", basis]);
    assert.equal(result.status, EXIT_RED, result.output);
    assert.match(result.output, /ist kein lesbarer Commit/);
  }
});

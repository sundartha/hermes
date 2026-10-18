import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

import { DURCHGELASSEN, manifests, runCase } from "../../tools/pruefungen-messen.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT_PATH = resolve(REPO_ROOT, "tools/eslint-konfig-pruefen.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const WRITE_OPTION = "--basis-schreiben";
const ONLY_KEYWORD = "only";
const ALLOWED_PARAMS = 3;
const LOOSENED_PARAMS = 5;
const TYPESCRIPT_FILES = ["{src,test,tools}/**/*.{ts,mts,cts}"];
const DECLARATION_FILES = ["**/*.d.ts"];
const WARN_SEVERITY = 1;
const ERROR_SEVERITY = 2;

function rootConfig({ maxParams = ALLOWED_PARAMS, noInlineConfig = true, typescript, declarations } = {}) {
  const config = {
    linterOptions: { noInlineConfig },
    rules: { "no-var": "error", "max-params": ["error", { max: maxParams }] },
  };
  const blocks = [config];
  if (typescript !== undefined) blocks.push(typescriptBlock(typescript));
  if (declarations !== undefined) blocks.push(typescriptBlock({ files: DECLARATION_FILES, ...declarations }));
  return `export default ${JSON.stringify(blocks)};\n`;
}

function weakenedNoEval(key) {
  return new RegExp(
    `^src \\(${key}\\): Regel no-eval ist \\[${WARN_SEVERITY},\\{"allowIndirect":false\\}\\], die Kopie sagt \\[${ERROR_SEVERITY},`,
    "m",
  );
}

function typescriptBlock({ files = TYPESCRIPT_FILES, noEval = "error" }) {
  return { files, rules: { "no-eval": noEval } };
}

function packageJson(scripts = {}) {
  return `${JSON.stringify({ type: "module", scripts })}\n`;
}

const PROJECT_FILES = {
  "package.json": packageJson(),
  "eslint.config.js": rootConfig(),
  "src/app.js": "export const app = 1;\n",
  "src/routes/voice.js": "export const voice = 1;\n",
  "test/app.test.js": 'import { test } from "node:test";\n\ntest("app", () => {});\n',
};

function writeFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function runScript(root, options = []) {
  const run = spawnSync(process.execPath, [SCRIPT_PATH, ...options, root], { encoding: "utf8" });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

function writeBaseline(root) {
  const written = runScript(root, [WRITE_OPTION]);
  assert.equal(written.status, EXIT_OK, written.output);
}

function withProject(files, action) {
  const root = mkdtempSync(join(tmpdir(), "eslint-konfig-pruefen-"));
  try {
    writeFiles(root, { ...PROJECT_FILES, ...files });
    return action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function checkAfterChange({ before = {}, after = {} } = {}) {
  return withProject(before, (root) => {
    writeBaseline(root);
    writeFiles(root, after);
    return runScript(root);
  });
}

test("eslint-konfig-pruefen: unveraenderte Konfiguration ergibt Exit 0 ohne Ausgabe", () => {
  const result = checkAfterChange();
  assert.equal(result.status, EXIT_OK, result.output);
  assert.equal(result.output, "");
});

test("eslint-konfig-pruefen: eslint.config.js in einem Unterordner stoppt die Pruefung und nennt Datei und Regel", () => {
  const result = checkAfterChange({
    after: { "src/routes/eslint.config.js": 'export default [{ rules: { "no-var": "off" } }];\n' },
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, /^src\/routes\/eslint\.config\.js: ESLint-Konfiguration/m);
  assert.match(result.output, /^src\/routes: Regel no-var ist \[0\], die Kopie sagt \[2\]$/m);
  assert.doesNotMatch(result.output, /^src: /m);
});

test("eslint-konfig-pruefen: eslint.config.* ausserhalb der geprueften Ordner stoppt die Pruefung", () => {
  const result = checkAfterChange({ after: { "docs/eslint.config.mjs": "export default [];\n" } });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, /^docs\/eslint\.config\.mjs: ESLint-Konfiguration/m);
});

test("eslint-konfig-pruefen: gelockerte Regel ohne neue Kopie stoppt die Pruefung und nennt Regel und Ordner", () => {
  const result = checkAfterChange({
    after: { "eslint.config.js": rootConfig({ maxParams: LOOSENED_PARAMS }) },
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(
    result.output,
    /^src: Regel max-params ist \[2,\{"max":5\}\], die Kopie sagt \[2,\{"max":3\}\]$/m,
  );
  assert.match(result.output, /--basis-schreiben/);
});

test("eslint-konfig-pruefen: neu geschriebene Kopie nimmt eine gewollte Aenderung auf", () => {
  const result = withProject({}, (root) => {
    writeBaseline(root);
    writeFiles(root, { "eslint.config.js": rootConfig({ maxParams: LOOSENED_PARAMS }) });
    writeBaseline(root);
    return runScript(root);
  });
  assert.equal(result.status, EXIT_OK, result.output);
});

test("eslint-konfig-pruefen: neuer Ordner ohne eigenen Eintrag in der Kopie wird am Standard gemessen", () => {
  const result = checkAfterChange({ after: { "src/neu/modul.js": "export const neu = 1;\n" } });
  assert.equal(result.status, EXIT_OK, result.output);
});

test("eslint-konfig-pruefen: fehlendes noInlineConfig stoppt die Pruefung, auch wenn die Kopie dazu passt", () => {
  const result = checkAfterChange({
    before: { "eslint.config.js": rootConfig({ noInlineConfig: false }) },
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, /^src: noInlineConfig ist nicht gesetzt$/m);
});

test("eslint-konfig-pruefen: fehlende Kopie stoppt die Pruefung", () => {
  const result = withProject({}, (root) => runScript(root));
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, /tools\/basis\/eslint-wirksam\.json fehlt/);
});

test("eslint-konfig-pruefen: test.only in einem Test stoppt die Pruefung und nennt Datei und Zeile", () => {
  const result = checkAfterChange({
    after: {
      "test/neu.test.js": `import { test } from "node:test";\n\ntest.${ONLY_KEYWORD}("neu", () => {});\n`,
    },
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, new RegExp(`^test/neu\\.test\\.js:3: \\.${ONLY_KEYWORD}\\(`, "m"));
});

test("eslint-konfig-pruefen: die only-Option in einer Hilfsdatei unter test/ stoppt die Pruefung", () => {
  const result = checkAfterChange({
    after: {
      "test/helpers/lauf.js": `export const optionen = { ${ONLY_KEYWORD}: true };\n`,
    },
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, new RegExp(`^test/helpers/lauf\\.js:1: ${ONLY_KEYWORD}: true`, "m"));
});

test("eslint-konfig-pruefen: der Schalter fuer nur markierte Tests in package.json stoppt die Pruefung", () => {
  const result = checkAfterChange({
    after: { "package.json": packageJson({ test: `node --test --test-${ONLY_KEYWORD}` }) },
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, new RegExp(`^package\\.json:1: --test-${ONLY_KEYWORD}`, "m"));
});

test("eslint-konfig-pruefen: abgeschwaechte TypeScript-Regel stoppt die Pruefung, auch ohne eine .ts-Datei", () => {
  const result = checkAfterChange({
    before: { "eslint.config.js": rootConfig({ typescript: {} }) },
    after: { "eslint.config.js": rootConfig({ typescript: { noEval: "warn" } }) },
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, weakenedNoEval("\\.ts"));
  assert.doesNotMatch(result.output, /^src: /m);
});

test("eslint-konfig-pruefen: abgeschwaechte Regel nur fuer .d.ts stoppt die Pruefung, auch ohne eine .d.ts-Datei", () => {
  const result = checkAfterChange({
    before: { "eslint.config.js": rootConfig({ typescript: {}, declarations: {} }) },
    after: { "eslint.config.js": rootConfig({ typescript: {}, declarations: { noEval: "warn" } }) },
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, weakenedNoEval("\\.d\\.ts"));
  assert.doesNotMatch(result.output, /^src \(\.ts\): /m);
});

test("eslint-konfig-pruefen: Ordner, dessen .ts-Dateien nicht mehr gelintet werden, stoppt die Pruefung", () => {
  const result = checkAfterChange({
    before: { "eslint.config.js": rootConfig({ typescript: {} }) },
    after: { "eslint.config.js": rootConfig({ typescript: { files: ["{src,tools}/**/*.{ts,mts,cts}"] } }) },
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, /^test \(\.ts\): test\/eslint-konfig-probe\.ts wird nicht mehr gelintet$/m);
});

test("eslint-konfig-pruefen: .mts und .cts, die anders geprueft werden als .ts, stoppen die Pruefung", () => {
  const result = checkAfterChange({
    before: { "eslint.config.js": rootConfig({ typescript: { files: ["{src,test,tools}/**/*.ts"] } }) },
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(
    result.output,
    /^src \(\.ts\): src\/eslint-konfig-probe\.mts wird anders geprüft als src\/eslint-konfig-probe\.ts$/m,
  );
  assert.match(result.output, /^test \(\.ts\): test\/eslint-konfig-probe\.cts wird anders geprüft/m);
});

test("eslint-konfig-pruefen: abgeschwaechte Regel nur fuer .test.ts stoppt die Pruefung", () => {
  const weaker = { files: ["**/*.test.ts"], rules: { "no-eval": "off" } };
  const result = checkAfterChange({
    before: { "eslint.config.js": rootConfig({ typescript: {} }) },
    after: { "eslint.config.js": rootConfig({ typescript: {} }).replace("];", `,${JSON.stringify(weaker)}];`) },
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, /^test \(\.ts\): test\/eslint-konfig-probe\.test\.ts wird anders geprüft als test\/eslint-konfig-probe\.ts$/m);
});

async function typescriptVerdict(zeilen) {
  const { probe } = manifests(REPO_ROOT).get("eslint");
  return runCase({ root: REPO_ROOT }, probe, { dateien: { "src/probe/probe.ts": zeilen } });
}

test("eslint.config.js: die Typwächter-Sperre lässt eine Funktion mit boolean-Rückgabe in .ts durch", async () => {
  const verdict = await typescriptVerdict([
    "export function istGesetzt(wert: unknown): boolean {",
    "  return wert !== undefined;",
    "}",
  ]);
  assert.equal(verdict, DURCHGELASSEN);
});

test("eslint.config.js: die Typwächter-Sperre lässt eine typeof-Einengung im Rumpf in .ts durch", async () => {
  const verdict = await typescriptVerdict([
    "export function verdoppelt(wert: unknown): number {",
    '  if (typeof wert === "number") return wert + wert;',
    "  return 0;",
    "}",
  ]);
  assert.equal(verdict, DURCHGELASSEN);
});

test("eslint.config.js: die Typwächter-Sperre lässt einen vom Compiler abgeleiteten Typwächter in filter durch", async () => {
  const verdict = await typescriptVerdict([
    "export function zahlen(werte: readonly unknown[]): number[] {",
    '  return werte.filter((wert) => typeof wert === "number");',
    "}",
  ]);
  assert.equal(verdict, DURCHGELASSEN);
});

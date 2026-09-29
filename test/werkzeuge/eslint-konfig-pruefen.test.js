import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT_PATH = resolve(REPO_ROOT, "tools/eslint-konfig-pruefen.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const WRITE_OPTION = "--basis-schreiben";
const ONLY_KEYWORD = "only";
const ALLOWED_PARAMS = 3;
const LOOSENED_PARAMS = 5;

function rootConfig({ maxParams = ALLOWED_PARAMS, noInlineConfig = true } = {}) {
  const config = {
    linterOptions: { noInlineConfig },
    rules: { "no-var": "error", "max-params": ["error", { max: maxParams }] },
  };
  return `export default [${JSON.stringify(config)}];\n`;
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

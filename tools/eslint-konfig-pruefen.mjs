import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ESLint } from "eslint";

const BASELINE_FILE = "tools/basis/eslint-wirksam.json";
const SCANNED_ROOTS = ["src", "test", "scripts", "tools", "apps/web/src"];
const LINTED_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const TYPESCRIPT_PROBE = "eslint-konfig-probe";
const TYPESCRIPT_EXTENSION = ".ts";
const TYPESCRIPT_TWINS = [".mts", ".cts", ".test.ts"];
const DECLARATION_EXTENSION = ".d.ts";
const TYPESCRIPT_KEY = ` (${TYPESCRIPT_EXTENSION})`;
const DECLARATION_KEY = ` (${DECLARATION_EXTENSION})`;
const JAVASCRIPT_KEY = "";
const SKIPPED_DIRECTORY_NAMES = new Set(["node_modules", ".git"]);
const NESTED_CHECKOUTS_DIRECTORY = ".claude/worktrees";
const ROOT_FOLDER = ".";
const CONFIG_FILE_PATTERN = /^eslint\.config\./;
const ONLY_SCAN_ROOT = "test";
const PACKAGE_JSON = "package.json";
const ONLY_PATTERNS = [/\.only\s*\(/, /\bonly["']?\s*:\s*true\b/, /--test-only\b/];
const COMPARED_SECTIONS = { linterOptions: "linterOptions.", rules: "Regel " };
const JSON_INDENT = 2;
const WRITE_OPTION = "basis-schreiben";
const WRITE_HINT = `Ist die Änderung gewollt, schreibt „node tools/eslint-konfig-pruefen.mjs --${WRITE_OPTION}“ die Kopie ${BASELINE_FILE} neu.`;

function sortedEntries(root, dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).sort((left, right) =>
    left.name < right.name ? -1 : 1,
  );
}

function isSkippedDirectory(entry, path) {
  return SKIPPED_DIRECTORY_NAMES.has(entry.name) || path === NESTED_CHECKOUTS_DIRECTORY;
}

function* directoriesBelow(root, start) {
  yield start;
  for (const entry of sortedEntries(root, start)) {
    const path = join(start, entry.name);
    if (entry.isDirectory() && !isSkippedDirectory(entry, path)) yield* directoriesBelow(root, path);
  }
}

function filesIn(root, dir) {
  return sortedEntries(root, dir)
    .filter((entry) => entry.isFile())
    .map((entry) => join(dir, entry.name));
}

function scannedFolders(root) {
  return SCANNED_ROOTS.filter((scanRoot) => existsSync(join(root, scanRoot))).flatMap((scanRoot) => [
    ...directoriesBelow(root, scanRoot),
  ]);
}

function javascriptProbes(root, folders) {
  return folders
    .map((folder) => ({ folder, key: JAVASCRIPT_KEY, file: filesIn(root, folder).find(isLintedFile) }))
    .filter(({ file }) => file !== undefined);
}

function typescriptProbes(folders) {
  return folders.flatMap((folder) => [
    { folder, key: TYPESCRIPT_KEY, file: join(folder, `${TYPESCRIPT_PROBE}${TYPESCRIPT_EXTENSION}`) },
    { folder, key: DECLARATION_KEY, file: join(folder, `${TYPESCRIPT_PROBE}${DECLARATION_EXTENSION}`) },
  ]);
}

function probes(root) {
  const folders = scannedFolders(root);
  return [...javascriptProbes(root, folders), ...typescriptProbes(folders)];
}

function isLintedFile(file) {
  return LINTED_EXTENSIONS.has(extname(file));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

async function effectiveConfig(eslint, root, file) {
  const config = await eslint.calculateConfigForFile(join(root, file));
  if (config === undefined) return null;
  const printed = JSON.parse(JSON.stringify(config));
  return canonical({ linterOptions: printed.linterOptions ?? {}, rules: printed.rules ?? {} });
}

async function twinsOf(eslint, root, probe) {
  if (probe.key !== TYPESCRIPT_KEY) return [];
  const stem = join(probe.folder, TYPESCRIPT_PROBE);
  return Promise.all(
    TYPESCRIPT_TWINS.map(async (extension) => ({
      file: `${stem}${extension}`,
      config: await effectiveConfig(eslint, root, `${stem}${extension}`),
    })),
  );
}

async function measure(root) {
  const eslint = new ESLint({ cwd: root });
  return Promise.all(
    probes(root).map(async (probe) => ({
      ...probe,
      config: await effectiveConfig(eslint, root, probe.file),
      twins: await twinsOf(eslint, root, probe),
    })),
  );
}

function recordedFolder(baseline, folder, key) {
  let candidate = folder;
  while (!Object.hasOwn(baseline, `${candidate}${key}`)) {
    if (candidate === ROOT_FOLDER) return undefined;
    candidate = dirname(candidate);
  }
  return `${candidate}${key}`;
}

function isSameConfig(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function baselineFrom(measured) {
  const baseline = {};
  for (const { folder, key, config } of measured) {
    const inherited = recordedFolder(baseline, dirname(folder), key);
    if (inherited === undefined) baseline[`${ROOT_FOLDER}${key}`] = config;
    else if (!isSameConfig(baseline[inherited], config)) baseline[`${folder}${key}`] = config;
  }
  return baseline;
}

function describe(value) {
  return value === undefined ? "nicht gesetzt" : JSON.stringify(value);
}

function labeledEntries(config) {
  return Object.fromEntries(
    Object.entries(COMPARED_SECTIONS).flatMap(([section, label]) =>
      Object.entries(config[section] ?? {}).map(([key, value]) => [`${label}${key}`, value]),
    ),
  );
}

function driftFindings(folder, expected, actual) {
  const expectedEntries = labeledEntries(expected);
  const actualEntries = labeledEntries(actual);
  const labels = [...new Set([...Object.keys(expectedEntries), ...Object.keys(actualEntries)])];
  return labels
    .filter((label) => !isSameConfig(expectedEntries[label], actualEntries[label]))
    .map(
      (label) =>
        `${folder}: ${label} ist ${describe(actualEntries[label])}, die Kopie sagt ${describe(expectedEntries[label])}`,
    );
}

function lintedStateFindings({ folder, key, file, config }, expected) {
  if (config === null && expected === null) return [];
  const state = config === null ? "wird nicht mehr gelintet" : "wird gelintet, laut Kopie nicht";
  return [`${folder}${key}: ${file} ${state}`];
}

function baselineFindings(baseline, probe) {
  const recorded = recordedFolder(baseline, probe.folder, probe.key);
  if (recorded === undefined) return [`${probe.folder}${probe.key}: keine Kopie in ${BASELINE_FILE}`];
  const expected = baseline[recorded];
  if (probe.config === null || expected === null) return lintedStateFindings(probe, expected);
  return driftFindings(`${probe.folder}${probe.key}`, expected, probe.config);
}

function twinFindings({ folder, file, config, twins = [] }) {
  return twins
    .filter((twin) => !isSameConfig(twin.config, config))
    .map((twin) => `${folder}${TYPESCRIPT_KEY}: ${twin.file} wird anders geprüft als ${file}`);
}

function inlineConfigFindings({ folder, key, config }) {
  if (config === null || config.linterOptions.noInlineConfig === true) return [];
  return [`${folder}${key}: noInlineConfig ist nicht gesetzt`];
}

function nestedConfigFindings(root) {
  return [...directoriesBelow(root, ROOT_FOLDER)]
    .filter((dir) => dir !== ROOT_FOLDER)
    .flatMap((dir) => filesIn(root, dir).filter((file) => CONFIG_FILE_PATTERN.test(basename(file))))
    .map((file) => `${file}: ESLint-Konfiguration außerhalb des Wurzelordners`);
}

function onlyFindingsInFile(root, file) {
  const lines = readFileSync(join(root, file), "utf8").split("\n");
  return lines.flatMap((line, index) =>
    ONLY_PATTERNS.map((pattern) => pattern.exec(line))
      .filter(Boolean)
      .map((match) => `${file}:${index + 1}: ${match[0]} schaltet die übrigen Tests ab`),
  );
}

function onlyFindings(root) {
  const testFiles = existsSync(join(root, ONLY_SCAN_ROOT))
    ? [...directoriesBelow(root, ONLY_SCAN_ROOT)].flatMap((dir) => filesIn(root, dir))
    : [];
  const packageJson = existsSync(join(root, PACKAGE_JSON)) ? [PACKAGE_JSON] : [];
  return [...testFiles, ...packageJson].flatMap((file) => onlyFindingsInFile(root, file));
}

function readBaseline(root) {
  const path = join(root, BASELINE_FILE);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

function writeBaseline(root, baseline) {
  const path = join(root, BASELINE_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(baseline, null, JSON_INDENT)}\n`);
}

function configFindings(root, measured) {
  const baseline = readBaseline(root);
  if (baseline === undefined) return [`${BASELINE_FILE} fehlt`];
  return measured.flatMap((probe) => baselineFindings(baseline, probe));
}

function report(root, measured) {
  const copyFindings = configFindings(root, measured);
  const findings = [
    ...copyFindings,
    ...measured.flatMap(inlineConfigFindings),
    ...measured.flatMap(twinFindings),
    ...nestedConfigFindings(root),
    ...onlyFindings(root),
  ];
  for (const finding of findings) console.error(finding);
  if (copyFindings.length > 0) console.error(WRITE_HINT);
  if (findings.length > 0) process.exitCode = 1;
}

const { values, positionals } = parseArgs({
  options: { [WRITE_OPTION]: { type: "boolean", default: false } },
  allowPositionals: true,
});
const [rootArgument = ROOT_FOLDER] = positionals;
const root = resolve(rootArgument);
const measured = await measure(root);
if (values[WRITE_OPTION]) writeBaseline(root, baselineFrom(measured));
else report(root, measured);

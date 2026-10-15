import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";

const BASELINE_FILE = "tools/basis/tsconfig-wirksam.json";
const CONFIG_FILE = "tsconfig.json";
const TSC = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const RESOLVED_FILE_LIST = "files";
const OPTIONS_SECTION = "compilerOptions";
const JSON_INDENT = 2;
const WRITE_OPTION = "basis-schreiben";
const WRITE_HINT = `Ist die Änderung gewollt, schreibt „node tools/tsconfig-pruefen.mjs --${WRITE_OPTION}“ die Kopie ${BASELINE_FILE} neu.`;
const EXIT_FINDING = 1;

function byKey(entries) {
  return Object.fromEntries(entries.toSorted(([left], [right]) => (left < right ? -1 : 1)));
}

function effectiveConfig(root) {
  const shown = execFileSync(
    process.execPath,
    [TSC, "--showConfig", "-p", join(root, CONFIG_FILE)],
    {
      encoding: "utf8",
    },
  );
  const entries = Object.entries(JSON.parse(shown)).filter(([key]) => key !== RESOLVED_FILE_LIST);
  const config = byKey(entries);
  return { ...config, [OPTIONS_SECTION]: byKey(Object.entries(config[OPTIONS_SECTION] ?? {})) };
}

function labeledEntries(config) {
  const { [OPTIONS_SECTION]: options = {}, ...rest } = config;
  const optionEntries = Object.entries(options).map(([key, value]) => [
    `${OPTIONS_SECTION}.${key}`,
    value,
  ]);
  return Object.fromEntries([...optionEntries, ...Object.entries(rest)]);
}

function describe(value) {
  return value === undefined ? "nicht gesetzt" : JSON.stringify(value);
}

function driftFindings(expected, actual) {
  const expectedEntries = labeledEntries(expected);
  const actualEntries = labeledEntries(actual);
  const labels = [
    ...new Set([...Object.keys(expectedEntries), ...Object.keys(actualEntries)]),
  ].sort();
  return labels
    .filter((label) => !isDeepStrictEqual(expectedEntries[label], actualEntries[label]))
    .map(
      (label) =>
        `${CONFIG_FILE}: ${label} ist ${describe(actualEntries[label])}, die Kopie sagt ${describe(expectedEntries[label])}`,
    );
}

function report(root, actual) {
  const path = join(root, BASELINE_FILE);
  const findings = existsSync(path)
    ? driftFindings(JSON.parse(readFileSync(path, "utf8")), actual)
    : [`${BASELINE_FILE} fehlt`];
  for (const finding of findings) console.error(finding);
  if (findings.length === 0) return 0;
  console.error(WRITE_HINT);
  return EXIT_FINDING;
}

const { values, positionals } = parseArgs({
  options: { [WRITE_OPTION]: { type: "boolean", default: false } },
  allowPositionals: true,
});
const root = resolve(positionals[0] ?? ".");
const actual = effectiveConfig(root);
if (values[WRITE_OPTION]) {
  writeFileSync(join(root, BASELINE_FILE), `${JSON.stringify(actual, null, JSON_INDENT)}\n`);
} else {
  process.exitCode = report(root, actual);
}

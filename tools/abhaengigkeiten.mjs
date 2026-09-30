import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_PATH = ".dependency-cruiser.cjs";
const KNOWN_VIOLATIONS_PATH = ".dependency-cruiser-known-violations.json";
const CHECKED_DIRECTORY = "src";
const DEPCRUISE_BIN = fileURLToPath(
  new URL("../node_modules/dependency-cruiser/bin/dependency-cruiser.mjs", import.meta.url),
);
const KEY_SEPARATOR = "\0";
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_USAGE = 2;
const MAX_OUTPUT_BYTES = 268_435_456;
const USAGE = "Aufruf: node tools/abhaengigkeiten.mjs --basis <commit>";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES });
}

function violationKey({ rule, from, to }) {
  return [rule.name, from, to].join(KEY_SEPARATOR);
}

function ruleComments() {
  const { forbidden } = createRequire(import.meta.url)(resolve(CONFIG_PATH));
  return new Map(forbidden.map(({ name, comment }) => [name, comment]));
}

function currentViolations() {
  const args = [DEPCRUISE_BIN, CHECKED_DIRECTORY, "--config", CONFIG_PATH];
  const result = run(process.execPath, [...args, "--output-type", "baseline"]);
  if (result.status !== EXIT_OK) {
    throw new Error(`dependency-cruiser ist gescheitert:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function knownViolationsInWorktree() {
  if (!existsSync(KNOWN_VIOLATIONS_PATH)) return [];
  return JSON.parse(readFileSync(KNOWN_VIOLATIONS_PATH, "utf8"));
}

function knownViolationsAtBasis(basis) {
  if (run("git", ["cat-file", "-e", `${basis}^{commit}`]).status !== EXIT_OK) {
    throw new Error(`Die Basis ${basis} ist kein Commit in diesem Checkout.`);
  }
  const shown = run("git", ["show", `${basis}:${KNOWN_VIOLATIONS_PATH}`]);
  return shown.status === EXIT_OK ? JSON.parse(shown.stdout) : undefined;
}

function missingFrom(violations, reference) {
  const referenceKeys = new Set(reference.map(violationKey));
  return violations.filter((violation) => !referenceKeys.has(violationKey(violation)));
}

function describe(violation, comments) {
  const { rule, from, to } = violation;
  return `${from} → ${to} verstößt gegen „${rule.name}“. ${comments.get(rule.name)}`;
}

function findingsFor({ violations, known, basisKnown }) {
  const comments = ruleComments();
  const newViolations = missingFrom(violations, known).map(
    (violation) => `Neuer Verstoß: ${describe(violation, comments)}`,
  );
  const grownEntries = missingFrom(known, basisKnown ?? known).map(
    (violation) =>
      `${KNOWN_VIOLATIONS_PATH} darf nur kürzer werden, neu eingefroren ist: ${describe(violation, comments)}`,
  );
  return [...newViolations, ...grownEntries];
}

function summary({ violations, known, basisKnown }) {
  const fixed = missingFrom(known, violations).length;
  const basisNote =
    basisKnown === undefined
      ? "die Basis hat noch keine eingefrorene Liste"
      : "die Liste ist gegenüber der Basis nicht gewachsen";
  return `${violations.length} Altverstöße, alle eingefroren in ${KNOWN_VIOLATIONS_PATH}; ${fixed} eingefrorene Einträge sind behoben und können gestrichen werden; ${basisNote}`;
}

function main() {
  const basis = optionValue("--basis");
  if (basis === undefined) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const state = {
    violations: currentViolations(),
    known: knownViolationsInWorktree(),
    basisKnown: knownViolationsAtBasis(basis),
  };
  const findings = findingsFor(state);
  for (const finding of findings) console.error(finding);
  if (findings.length > 0) return EXIT_FINDING;
  console.log(summary(state));
  return EXIT_OK;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error.message);
  process.exitCode = EXIT_USAGE;
}

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bestaendeNurKuerzer } from "./abhaengigkeiten/bestaende.mjs";
import { testordnung } from "./abhaengigkeiten/testordnung.mjs";
import { umbenennungen } from "./umbenennung.mjs";

const CONFIG_PATH = ".dependency-cruiser.cjs";
const SOURCE_DIRECTORY = "src";
const TEST_DIRECTORY = "test";
const DEPCRUISE_BIN = fileURLToPath(
  new URL("../node_modules/dependency-cruiser/bin/dependency-cruiser.mjs", import.meta.url),
);
const TEST_IMPORT_RULES = new Set(["tests-nur-ueber-eingaenge", "werkzeug-tests-ohne-src"]);
const FROZEN_LISTS = [
  {
    path: ".dependency-cruiser-known-violations.json",
    label: "Altverstöße",
    covers: (violation) => !TEST_IMPORT_RULES.has(violation.rule.name),
  },
  {
    path: "tools/basis/test-importe.json",
    label: "Testimporte an internen Modulen",
    covers: (violation) => TEST_IMPORT_RULES.has(violation.rule.name),
  },
];
const KEY_SEPARATOR = "\0";
const TYPESCRIPT_PATH = /\.[cm]?ts$/;
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

function checkedDirectories() {
  return existsSync(TEST_DIRECTORY) ? [SOURCE_DIRECTORY, TEST_DIRECTORY] : [SOURCE_DIRECTORY];
}

function currentViolations() {
  const args = [DEPCRUISE_BIN, ...checkedDirectories(), "--config", CONFIG_PATH];
  const result = run(process.execPath, [...args, "--output-type", "baseline"]);
  if (result.status !== EXIT_OK) {
    throw new Error(`dependency-cruiser ist gescheitert:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function checkBasis(basis) {
  if (run("git", ["cat-file", "-e", `${basis}^{commit}`]).status !== EXIT_OK) {
    throw new Error(`Die Basis ${basis} ist kein Commit in diesem Checkout.`);
  }
}

function frozenInWorktree(path) {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

function frozenAtBasis(basis, path) {
  const shown = run("git", ["show", `${basis}:${path}`]);
  return shown.status === EXIT_OK ? JSON.parse(shown.stdout) : undefined;
}

function listState(list, { violations, basis }) {
  return {
    ...list,
    violations: violations.filter(list.covers),
    known: frozenInWorktree(list.path),
    basisKnown: frozenAtBasis(basis, list.path),
  };
}

function missingFrom(violations, reference) {
  const referenceKeys = new Set(reference.map(violationKey));
  return violations.filter((violation) => !referenceKeys.has(violationKey(violation)));
}

function grownBeyond(entries, reference, keyOf) {
  const left = new Map();
  for (const entry of reference)
    left.set(violationKey(entry), (left.get(violationKey(entry)) ?? 0) + 1);
  return entries.filter((entry) => {
    const key = keyOf(entry);
    const count = left.get(key) ?? 0;
    left.set(key, count - 1);
    return count <= 0;
  });
}

function samePath(path) {
  return path;
}

async function oldPathOf(basis, states) {
  const grown = states.flatMap(({ known, basisKnown }) => missingFrom(known, basisKnown ?? known));
  const renamed = grown.some(
    ({ from, to }) => TYPESCRIPT_PATH.test(from) || TYPESCRIPT_PATH.test(to),
  );
  if (!renamed) return samePath;
  const { nurTypen } = await umbenennungen({ von: basis });
  return (path) => nurTypen(path) ?? path;
}

function describe(violation, comments) {
  const { rule, from, to } = violation;
  return `${from} → ${to} verstößt gegen „${rule.name}“. ${comments.get(rule.name)}`;
}

function findingsFor({ path, violations, known, basisKnown }, { comments, oldPath }) {
  const newViolations = missingFrom(violations, known).map(
    (violation) => `Neuer Verstoß: ${describe(violation, comments)}`,
  );
  const asBefore = ({ rule, from, to }) =>
    violationKey({ rule, from: oldPath(from), to: oldPath(to) });
  const grownEntries = grownBeyond(known, basisKnown ?? known, asBefore).map(
    (violation) =>
      `${path} darf nur kürzer werden, neu eingefroren ist: ${describe(violation, comments)}`,
  );
  return [...newViolations, ...grownEntries];
}

function summary({ path, label, violations, known, basisKnown }) {
  const fixed = missingFrom(known, violations).length;
  const basisNote =
    basisKnown === undefined
      ? "die Basis hat noch keine eingefrorene Liste"
      : "die Liste ist gegenüber der Basis nicht gewachsen";
  return `${violations.length} ${label}, alle eingefroren in ${path}; ${fixed} eingefrorene Einträge sind behoben und können gestrichen werden; ${basisNote}`;
}

async function main() {
  const basis = optionValue("--basis");
  if (basis === undefined) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  checkBasis(basis);
  const violations = currentViolations();
  const states = FROZEN_LISTS.map((list) => listState(list, { violations, basis }));
  const comments = ruleComments();
  const oldPath = await oldPathOf(basis, states);
  const order = testordnung(basis);
  const findings = [
    ...states.flatMap((state) => findingsFor(state, { comments, oldPath })),
    ...bestaendeNurKuerzer(basis),
    ...order.befunde,
  ];
  for (const finding of findings) console.error(finding);
  if (findings.length > 0) return EXIT_FINDING;
  for (const state of states) console.log(summary(state));
  console.log(order.zusammenfassung);
  return EXIT_OK;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = EXIT_USAGE;
}

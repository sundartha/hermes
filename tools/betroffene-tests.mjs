import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { dependentsGraph, testsReaching } from "./testgraph.mjs";
import { mitNeuenPfaden, umbenennungen } from "./umbenennung.mjs";

const DEFAULT_BASE_REF = "upstream/master";
const SELECTABLE_PREFIXES = ["src/", "test/"];
const WEB_PREFIX = "apps/web/";
const FULL_SUITE_GLOB = "test/**/*.test.{js,ts}";
const WEB_SUITE_GLOB = "apps/web/test/**/*.test.js";
const NAME_STATUS_ENTRY = /([A-Z])\d*\0([^\0]+)\0/g;
const DELETED = "D";
const BANK = "regression";
const TEST_CONCURRENCY = 4;
const NODE_TEST_FLAGS = ["--", `--test-concurrency=${TEST_CONCURRENCY}`];
const RUNNER = fileURLToPath(new URL("../test/testbaenke-run.mjs", import.meta.url));
const EXIT_FAILURE = 1;
const NO_CHANGES_MESSAGE = "Keine Änderungen gegenüber der Basis, keine Tests betroffen.";
const SKIP_FULL_SUITE_OPTION = "ohne-volle-suite";
const FULL_SUITE_ELSEWHERE_MESSAGE = "Die volle Suite läuft im Job CI und wird hier ausgelassen.";
const MISSING_BASE_HINT = "git fetch upstream oder npm run prepare";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout : null;
}

function baseExists(baseRef) {
  return git(["rev-parse", "--verify", "--quiet", baseRef]) !== null;
}

export async function changedFiles(baseRef) {
  const mergeBase = git(["merge-base", "HEAD", baseRef])?.trim();
  if (!mergeBase) return null;
  const diff = git(["diff", "--name-status", "--no-renames", "-z", mergeBase]);
  if (diff === null) return null;
  const changes = [...diff.matchAll(NAME_STATUS_ENTRY)].map(([, status, path]) => ({
    status,
    path,
  }));
  return mitNeuenPfaden(changes, await umbenennungen({ von: mergeBase }));
}

function needsFullSuite({ status, path }) {
  return status === DELETED || !SELECTABLE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function affectedTestFiles(changes) {
  if (changes.some(needsFullSuite)) return null;
  const dependents = await dependentsGraph();
  const reachedPerChange = changes.map(({ path }) => testsReaching(path, dependents));
  if (reachedPerChange.some((reached) => reached.length === 0)) return null;
  return [...new Set(reachedPerChange.flat())].sort();
}

export async function testPatternsFor(changes) {
  if (changes === null) return [FULL_SUITE_GLOB];
  const rootPatterns = (await affectedTestFiles(changes)) ?? [FULL_SUITE_GLOB];
  const touchesWeb = changes.some(({ path }) => path.startsWith(WEB_PREFIX));
  return touchesWeb ? [...rootPatterns, WEB_SUITE_GLOB] : rootPatterns;
}

function withoutFullSuite(patterns) {
  return patterns.filter((pattern) => pattern !== FULL_SUITE_GLOB);
}

function runBank(patterns) {
  const result = spawnSync(process.execPath, [RUNNER, BANK, ...patterns, ...NODE_TEST_FLAGS], {
    stdio: "inherit",
  });
  return result.status ?? EXIT_FAILURE;
}

async function main() {
  const { values } = parseArgs({
    options: {
      basis: { type: "string", default: DEFAULT_BASE_REF },
      [SKIP_FULL_SUITE_OPTION]: { type: "boolean", default: false },
    },
  });
  if (!baseExists(values.basis)) {
    console.error(`Basis ${values.basis} fehlt; ${MISSING_BASE_HINT}.`);
    process.exitCode = EXIT_FAILURE;
    return;
  }
  const changes = await changedFiles(values.basis);
  if (changes?.length === 0) {
    console.log(NO_CHANGES_MESSAGE);
    return;
  }
  const patterns = await testPatternsFor(changes);
  const skipsFullSuite = values[SKIP_FULL_SUITE_OPTION] && patterns.includes(FULL_SUITE_GLOB);
  if (skipsFullSuite) console.log(FULL_SUITE_ELSEWHERE_MESSAGE);
  const selected = skipsFullSuite ? withoutFullSuite(patterns) : patterns;
  if (selected.length > 0) process.exitCode = runBank(selected);
}

if (import.meta.url === pathToFileURL(realpathSync(argv[1] ?? ".")).href) await main();

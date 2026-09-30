import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { cruise } from "dependency-cruiser";

const DEFAULT_BASE_REF = "upstream/master";
const GRAPH_ROOTS = ["src", "test"];
const CRUISE_OPTIONS = { doNotFollow: { path: "node_modules" }, moduleSystems: ["es6", "cjs"] };
const SELECTABLE_PREFIXES = ["src/", "test/"];
const WEB_PREFIX = "apps/web/";
const FULL_SUITE_GLOB = "test/**/*.test.js";
const WEB_SUITE_GLOB = "apps/web/test/**/*.test.js";
const TEST_FILE = /^test\/.+\.test\.js$/;
const NAME_STATUS_ENTRY = /([A-Z])\d*\0([^\0]+)\0/g;
const DELETED = "D";
const BANK = "regression";
const TEST_CONCURRENCY = 4;
const NODE_TEST_FLAGS = ["--", `--test-concurrency=${TEST_CONCURRENCY}`];
const RUNNER = fileURLToPath(new URL("../test/testbaenke-run.mjs", import.meta.url));
const EXIT_FAILURE = 1;
const NO_CHANGES_MESSAGE = "Keine Änderungen gegenüber der Basis, keine Tests betroffen.";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout : null;
}

function changedFiles(baseRef) {
  const mergeBase = git(["merge-base", "HEAD", baseRef])?.trim();
  if (!mergeBase) return null;
  const diff = git(["diff", "--name-status", "--no-renames", "-z", mergeBase]);
  if (diff === null) return null;
  return [...diff.matchAll(NAME_STATUS_ENTRY)].map(([, status, path]) => ({ status, path }));
}

function needsFullSuite({ status, path }) {
  return status === DELETED || !SELECTABLE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function dependentsGraph() {
  const { output } = await cruise(GRAPH_ROOTS, CRUISE_OPTIONS);
  const edges = output.modules.flatMap(({ source, dependencies }) =>
    dependencies.map(({ resolved }) => ({ source, resolved })),
  );
  return Map.groupBy(edges, (edge) => edge.resolved);
}

function testsReaching(start, dependents) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const importers = dependents.get(queue.pop()) ?? [];
    const unseen = importers.map((edge) => edge.source).filter((source) => !seen.has(source));
    for (const source of unseen) seen.add(source);
    queue.push(...unseen);
  }
  return [...seen].filter((file) => TEST_FILE.test(file));
}

async function affectedTestFiles(changes) {
  if (changes.some(needsFullSuite)) return null;
  const dependents = await dependentsGraph();
  const reachedPerChange = changes.map(({ path }) => testsReaching(path, dependents));
  if (reachedPerChange.some((reached) => reached.length === 0)) return null;
  return [...new Set(reachedPerChange.flat())].sort();
}

async function testPatternsFor(changes) {
  if (changes === null) return [FULL_SUITE_GLOB];
  const rootPatterns = (await affectedTestFiles(changes)) ?? [FULL_SUITE_GLOB];
  const touchesWeb = changes.some(({ path }) => path.startsWith(WEB_PREFIX));
  return touchesWeb ? [...rootPatterns, WEB_SUITE_GLOB] : rootPatterns;
}

function runBank(patterns) {
  const result = spawnSync(process.execPath, [RUNNER, BANK, ...patterns, ...NODE_TEST_FLAGS], {
    stdio: "inherit",
  });
  return result.status ?? EXIT_FAILURE;
}

async function main() {
  const { values } = parseArgs({
    options: { basis: { type: "string", default: DEFAULT_BASE_REF } },
  });
  const changes = changedFiles(values.basis);
  if (changes?.length === 0) {
    console.log(NO_CHANGES_MESSAGE);
    return;
  }
  process.exitCode = runBank(await testPatternsFor(changes));
}

await main();

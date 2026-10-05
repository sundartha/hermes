import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const PROTOCOL_DIR = ".pruefung";
const LINT_REPORT = join(PROTOCOL_DIR, "lint.json");
const MAX_LINT_FINDINGS = 20;
const MAX_ABORT_LINES = 20;
const ERROR_SEVERITY = 2;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const SKIP_FULL_SUITE_FLAG = "--ohne-volle-suite";
const DEFAULT_BASE_REF = "upstream/master";
const TOOL_BANK = "regression";
const TOOL_TEST_GLOB = "test/werkzeuge/**/*.test.js";
const TEST_CONCURRENCY = 4;
const RUNNER = fileURLToPath(new URL("../test/testbaenke-run.mjs", import.meta.url));
const DELETED = "D";
const NAME_STATUS_ENTRY = /([A-Z])\d*\0([^\0]+)\0/g;
const PRODUCT_PREFIXES = ["src/", "test/"];
const TOOL_TEST_PREFIX = "test/werkzeuge/";

function npmRun(script, args, stdio) {
  const result = spawnSync("npm", ["run", "--silent", script, "--", ...args], {
    encoding: "utf8",
    stdio,
  });
  return { ...result, status: result.status ?? EXIT_FAILURE };
}

function readLintReport() {
  try {
    return JSON.parse(readFileSync(LINT_REPORT, "utf8"));
  } catch {
    return [];
  }
}

function lintErrors() {
  return readLintReport().flatMap(({ filePath, messages }) =>
    messages
      .filter(({ severity }) => severity === ERROR_SEVERITY)
      .map(({ line, column, message, ruleId }) => {
        const file = relative(process.cwd(), filePath);
        return `${file}:${line}:${column} ${message} (${ruleId ?? "Parser"})`;
      }),
  );
}

function findingLines(errors) {
  const shown = errors.slice(0, MAX_LINT_FINDINGS);
  const hidden = errors.length - shown.length;
  const more = hidden > 0 ? [`… und ${hidden} weitere in ${LINT_REPORT}`] : [];
  return [`Lint: ${errors.length} Befunde`, ...shown, ...more];
}

function abortLines({ status, stdout, stderr }) {
  const output = `${stderr}${stdout}`.split("\n").filter((line) => line.trim() !== "");
  return [`Lint abgebrochen (Exit ${status}):`, ...output.slice(0, MAX_ABORT_LINES)];
}

function lint() {
  mkdirSync(PROTOCOL_DIR, { recursive: true });
  rmSync(LINT_REPORT, { force: true });
  const result = npmRun("lint", ["--format", "json", "--output-file", LINT_REPORT], "pipe");
  if (result.status === 0) return 0;
  const errors = lintErrors();
  const lines = errors.length > 0 ? findingLines(errors) : abortLines(result);
  for (const line of lines) console.log(line);
  return result.status;
}

function affectedTests(args) {
  return npmRun("test:betroffen", args, "inherit").status;
}

function changedEntries(baseRef) {
  const mergeBase = spawnSync("git", ["merge-base", "HEAD", baseRef], { encoding: "utf8" });
  if (mergeBase.status !== 0) return null;
  const diff = spawnSync(
    "git",
    ["diff", "--name-status", "--no-renames", "-z", mergeBase.stdout.trim()],
    { encoding: "utf8" },
  );
  if (diff.status !== 0) return null;
  return [...diff.stdout.matchAll(NAME_STATUS_ENTRY)].map(([, status, path]) => ({ status, path }));
}

function isProductChange({ status, path }) {
  const isProductPath = PRODUCT_PREFIXES.some((prefix) => path.startsWith(prefix));
  return status !== DELETED && isProductPath && !path.startsWith(TOOL_TEST_PREFIX);
}

function needsToolTests(baseRef) {
  const changes = changedEntries(baseRef);
  return changes === null || changes.some((change) => !isProductChange(change));
}

function toolTests() {
  const flags = ["--", `--test-concurrency=${TEST_CONCURRENCY}`];
  const result = spawnSync(process.execPath, [RUNNER, TOOL_BANK, TOOL_TEST_GLOB, ...flags], {
    stdio: "inherit",
  });
  return result.status ?? EXIT_FAILURE;
}

function parseOptions() {
  const { values } = parseArgs({
    options: { basis: { type: "string" }, "vor-push": { type: "boolean", default: false } },
  });
  return values;
}

function affectedTestArgs({ basis, "vor-push": beforePush }) {
  if (basis !== undefined) return ["--basis", basis, SKIP_FULL_SUITE_FLAG];
  return beforePush ? [SKIP_FULL_SUITE_FLAG] : [];
}

function main() {
  const options = parseOptions();
  if (options.basis === "") {
    console.error("Basis fehlt: --basis ist leer.");
    return EXIT_USAGE;
  }
  const args = affectedTestArgs(options);
  const lintStatus = lint();
  if (lintStatus !== 0) return lintStatus;
  const affectedStatus = affectedTests(args);
  const runsToolTests = options["vor-push"] || options.basis !== undefined;
  if (!runsToolTests || !needsToolTests(options.basis ?? DEFAULT_BASE_REF)) {
    return affectedStatus;
  }
  const toolStatus = toolTests();
  return affectedStatus === 0 ? toolStatus : affectedStatus;
}

process.exitCode = main();

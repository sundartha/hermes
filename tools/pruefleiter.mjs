import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

const PROTOCOL_DIR = ".pruefung";
const LINT_REPORT = join(PROTOCOL_DIR, "lint.json");
const MAX_LINT_FINDINGS = 20;
const MAX_ABORT_LINES = 20;
const ERROR_SEVERITY = 2;
const EXIT_FAILURE = 1;
const FIRST_ARGUMENT = 2;

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

function main() {
  const lintStatus = lint();
  return lintStatus === 0 ? affectedTests(process.argv.slice(FIRST_ARGUMENT)) : lintStatus;
}

process.exitCode = main();

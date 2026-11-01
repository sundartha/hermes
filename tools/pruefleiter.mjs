import { spawnSync } from "node:child_process";
import { existsSync, globSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { TOOL_TEST_DIRECTORY, TOOL_TEST_GLOB } from "../test/testbaenke-run.mjs";
import { MELDUNG, zweckBlock } from "./auftrag/zweck.mjs";
import { changedFiles } from "./betroffene-tests.mjs";
import { nimmSperreAuchFuerKindprozesse } from "./schwerlauf/sperre.mjs";
import { waehleTeil } from "./testlaufzeit/teilung.mjs";

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
const TEST_CONCURRENCY = 4;
const RUNNER = fileURLToPath(new URL("../test/testbaenke-run.mjs", import.meta.url));
const DELETED = "D";
const PRODUCT_PREFIXES = ["src/", "test/"];
const FIRST_ARGUMENT = 2;
const PART_PATTERN = /^([1-9]\d*)\/([1-9]\d*)$/;
const PART_REPORT_PREFIX = "werkzeugteil-";
const PART_REPORT_SUFFIX = ".jsonl";
const FILE_REPORTER = fileURLToPath(new URL("./testlaufzeit-reporter.mjs", import.meta.url));
const JOB_SUCCESS = "success";
const EXCLUSIVE_MODES = [
  "vor-push",
  "ohne-werkzeugtests",
  "werkzeugteil",
  "teile-pruefen",
  "werkzeugtests-gewollt",
];
const TOOL_TESTS_WANTED = "ja";
const TOOL_TESTS_NOT_WANTED = "nein";

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

function isProductChange({ status, path }) {
  const isProductPath = PRODUCT_PREFIXES.some((prefix) => path.startsWith(prefix));
  return status !== DELETED && isProductPath && !path.startsWith(TOOL_TEST_DIRECTORY);
}

async function needsToolTests(baseRef) {
  const changes = await changedFiles(baseRef);
  return changes === null || changes.some((change) => !isProductChange(change));
}

async function toolTestsWanted(options) {
  return options["alle-werkzeugtests"] || needsToolTests(selectedBaseRef(options));
}

function partReportPath({ index }) {
  return join(PROTOCOL_DIR, `${PART_REPORT_PREFIX}${index}${PART_REPORT_SUFFIX}`);
}

function partFlags(part) {
  if (part === undefined) return [];
  return [
    "--test-reporter-destination=stdout",
    `--test-reporter=${FILE_REPORTER}`,
    `--test-reporter-destination=${partReportPath(part)}`,
  ];
}

function toolTests(part) {
  const files =
    part === undefined
      ? [TOOL_TEST_GLOB]
      : waehleTeil({ dateien: globSync(TOOL_TEST_GLOB), teil: part.index, anzahl: part.total });
  if (files === null) return EXIT_FAILURE;
  const flags = ["--", `--test-concurrency=${TEST_CONCURRENCY}`, ...partFlags(part)];
  const result = spawnSync(process.execPath, [RUNNER, TOOL_BANK, ...files, ...flags], {
    stdio: "inherit",
  });
  return result.status ?? EXIT_FAILURE;
}

function parseOptions() {
  const { values } = parseArgs({
    options: {
      basis: { type: "string" },
      "vor-push": { type: "boolean", default: false },
      "ohne-werkzeugtests": { type: "boolean", default: false },
      "alle-werkzeugtests": { type: "boolean", default: false },
      "werkzeugtests-gewollt": { type: "boolean", default: false },
      werkzeugteil: { type: "string" },
      "teile-pruefen": { type: "string" },
      jobs: { type: "string" },
    },
  });
  return values;
}

function affectedTestArgs({ basis, "vor-push": beforePush }) {
  if (basis !== undefined) return ["--basis", basis, SKIP_FULL_SUITE_FLAG];
  return beforePush ? [SKIP_FULL_SUITE_FLAG] : [];
}

function parsePart(text) {
  const match = PART_PATTERN.exec(text);
  if (!match) return null;
  const [index, total] = [Number(match[1]), Number(match[2])];
  return index <= total ? { index, total } : null;
}

function selectedBaseRef({ basis }) {
  return basis ?? DEFAULT_BASE_REF;
}

function runsToolTests(options) {
  const wanted = options["vor-push"] || options.basis !== undefined;
  return wanted && !options["ohne-werkzeugtests"];
}

async function fullRun(options) {
  const lintStatus = lint();
  if (lintStatus !== 0) return lintStatus;
  const affectedStatus = affectedTests(affectedTestArgs(options));
  if (!runsToolTests(options) || !(await toolTestsWanted(options))) {
    return affectedStatus;
  }
  const toolStatus = toolTests();
  return affectedStatus === 0 ? toolStatus : affectedStatus;
}

async function partRun(options, part) {
  if (!(await toolTestsWanted(options))) {
    console.log(
      `Werkzeugtests Teil ${part.index}/${part.total}: keine Änderung außerhalb von src/ und test/.`,
    );
    return 0;
  }
  return toolTests(part);
}

async function announceToolTests(options) {
  console.log((await toolTestsWanted(options)) ? TOOL_TESTS_WANTED : TOOL_TESTS_NOT_WANTED);
  return 0;
}

function failedJobs(text) {
  const jobs = Object.entries(JSON.parse(text));
  if (jobs.length === 0) return ["--jobs nennt keinen Teil."];
  return jobs
    .filter(([, { result }]) => result !== JOB_SUCCESS)
    .map(([name, { result }]) => `Teil ${name}: ${result}`);
}

function reportedFiles(directory) {
  if (!existsSync(directory)) return [];
  const reports = readdirSync(directory).filter(
    (name) => name.startsWith(PART_REPORT_PREFIX) && name.endsWith(PART_REPORT_SUFFIX),
  );
  return reports.flatMap((report) =>
    readFileSync(join(directory, report), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => ({ report, file: JSON.parse(line).datei })),
  );
}

function coverageFindings(expected, reported) {
  const runs = new Map(expected.map((file) => [file, []]));
  const unknown = reported.filter(({ file }) => !runs.has(file));
  for (const { report, file } of reported) runs.get(file)?.push(report);
  return [
    ...unknown.map(
      ({ report, file }) =>
        `${file}: in ${report} gelaufen, gehört aber nicht zu ${TOOL_TEST_GLOB}`,
    ),
    ...[...runs]
      .filter(([, reports]) => reports.length !== 1)
      .map(
        ([file, reports]) => `${file}: in ${reports.length} Teilen gelaufen statt in genau einem`,
      ),
  ];
}

function expectedToolTestFiles(toolTestsNeeded) {
  if (!toolTestsNeeded) return [];
  return globSync(TOOL_TEST_GLOB).sort();
}

function emptyGlobFindings(toolTestsNeeded, expected) {
  if (expected.length > 0 || !toolTestsNeeded) return [];
  return [`${TOOL_TEST_GLOB} findet keine Werkzeug-Testdatei.`];
}

async function checkParts(options) {
  const toolTestsNeeded = await toolTestsWanted(options);
  const expected = expectedToolTestFiles(toolTestsNeeded);
  const findings = [
    ...emptyGlobFindings(toolTestsNeeded, expected),
    ...failedJobs(options.jobs),
    ...coverageFindings(expected, reportedFiles(options["teile-pruefen"])),
  ];
  if (findings.length === 0) {
    console.log(
      `Prüfleiter-Teile: alle erfolgreich, ${expected.length} Werkzeug-Testdateien je genau einmal gelaufen.`,
    );
    return 0;
  }
  console.log(`Prüfleiter-Teile: ${findings.length} Befunde`);
  for (const finding of findings) console.log(finding);
  return EXIT_FAILURE;
}

function usageError(options) {
  if (options.basis === "") return "Basis fehlt: --basis ist leer.";
  const modes = EXCLUSIVE_MODES.filter(
    (mode) => options[mode] !== undefined && options[mode] !== false,
  );
  if (modes.length > 1)
    return `Nur eine dieser Optionen auf einmal: ${modes.map((mode) => `--${mode}`).join(", ")}.`;
  if (options.werkzeugteil !== undefined && parsePart(options.werkzeugteil) === null) {
    return `--werkzeugteil erwartet Teil/Teile wie 2/4 mit 1 ≤ Teil ≤ Teile, nicht „${options.werkzeugteil}“.`;
  }
  if (options["teile-pruefen"] === "")
    return "--teile-pruefen braucht den Ordner mit den Berichten der Teile.";
  if ((options["teile-pruefen"] === undefined) !== (options.jobs === undefined)) {
    return "--teile-pruefen und --jobs gehören zusammen (Ergebnisse aller Teile als JSON aus needs).";
  }
  return null;
}

async function main() {
  const options = parseOptions();
  const error = usageError(options);
  if (error !== null) {
    console.error(error);
    return EXIT_USAGE;
  }
  if (options["werkzeugtests-gewollt"]) return announceToolTests(options);
  await nimmSperreAuchFuerKindprozesse(["pruefleiter", ...process.argv.slice(FIRST_ARGUMENT)].join(" "), {
    vorrangFuerPush: true,
  });
  if (options["teile-pruefen"] !== undefined) return checkParts(options);
  if (options.werkzeugteil !== undefined) return partRun(options, parsePart(options.werkzeugteil));
  return fullRun(options);
}

function mitZweck(status) {
  if (status !== 0) console.error(zweckBlock(MELDUNG.PRUEFLEITER).join("\n"));
  return status;
}

process.exitCode = mitZweck(await main());

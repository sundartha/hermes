import { spawnSync } from "node:child_process";
import { existsSync, globSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { env } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { TOOL_TEST_GLOB } from "../test/testbaenke-run.mjs";
import { MELDUNG, zweckBlock } from "./auftrag/zweck.mjs";
import { nimmSperreAuchFuerKindprozesse } from "./schwerlauf/sperre.mjs";
import { dateienDesTeils, waehleTeil, werkzeugMessdatei, werkzeugTeilzahl } from "./testlaufzeit/teilung.mjs";
import { planToolTests } from "./werkzeugtests/auswahl.mjs";
import { guardedRun } from "./werkzeugtests/waechter.mjs";

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
const FIRST_ARGUMENT = 2;
const PART_PATTERN = /^([1-9]\d*)\/([1-9]\d*)$/;
const PART_REPORT_PREFIX = "werkzeugteil-";
const PART_REPORT_SUFFIX = ".jsonl";
const FILE_REPORTER = fileURLToPath(new URL("./testlaufzeit-reporter.mjs", import.meta.url));
const RED_FILES_REPORTER = fileURLToPath(new URL("./werkzeugtests/rote-dateien-reporter.mjs", import.meta.url));
const COST_FILE_VARIABLE = "TESTKOSTEN_DATEI";
const NO_TOOL_TESTS = "keine";
const LIST_TOOL_TESTS = "liste";
const ALL_TOOL_TESTS = "alle";
const JOB_SUCCESS = "success";
const EXCLUSIVE_MODES = [
  "vor-push",
  "ohne-werkzeugtests",
  "werkzeugteil",
  "teile-pruefen",
  "werkzeugtests-gewollt",
  "teile-planen",
];
const EVENT_SELECTION = { pull_request: "werkzeugtests-aus-liste", schedule: "alle-werkzeugtests" };
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

function withEventSelection(options) {
  const flag = EVENT_SELECTION[options["fuer-ereignis"]];
  return flag === undefined ? options : { ...options, [flag]: true };
}

async function toolTestPlan(rawOptions) {
  const options = withEventSelection(rawOptions);
  const plan = await planToolTests(selectedBaseRef(options));
  if (options["alle-werkzeugtests"]) return { ...plan, art: ALL_TOOL_TESTS };
  if (!plan.reinProdukt || options["werkzeugtests-aus-liste"]) return plan;
  return { ...plan, art: NO_TOOL_TESTS };
}

function partReportPath({ index }) {
  return join(PROTOCOL_DIR, `${PART_REPORT_PREFIX}${index}${PART_REPORT_SUFFIX}`);
}

function reporterFlags({ laufzeit, rot }) {
  const pairs = [
    [FILE_REPORTER, laufzeit],
    [RED_FILES_REPORTER, rot],
  ].filter(([, destination]) => destination !== undefined);
  if (pairs.length === 0) return [];
  return [
    "--test-reporter-destination=stdout",
    ...pairs.flatMap(([reporter, destination]) => [
      `--test-reporter=${reporter}`,
      `--test-reporter-destination=${destination}`,
    ]),
  ];
}

function withoutCostFile() {
  return Object.fromEntries(Object.entries(env).filter(([name]) => name !== COST_FILE_VARIABLE));
}

function runToolBank(files, { cwd = process.cwd(), laufzeit, rot, still = false } = {}) {
  const flags = ["--", `--test-concurrency=${TEST_CONCURRENCY}`, ...reporterFlags({ laufzeit, rot })];
  const result = spawnSync(process.execPath, [RUNNER, TOOL_BANK, ...files, ...flags], {
    cwd,
    env: still ? withoutCostFile() : env,
    stdio: still ? "ignore" : "inherit",
  });
  return result.status ?? EXIT_FAILURE;
}

function listedFiles(listFile) {
  return readFileSync(listFile, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

function toolTestFiles(plan, part, listFile) {
  if (listFile !== undefined) return listedFiles(listFile);
  if (plan.art === LIST_TOOL_TESTS) {
    if (part === undefined) return plan.dateien;
    return dateienDesTeils({
      dateien: plan.dateien,
      teil: part.index,
      anzahl: part.total,
      messdatei: werkzeugMessdatei(),
    }).dateien;
  }
  const all = globSync(TOOL_TEST_GLOB);
  if (part === undefined) return all;
  return waehleTeil({ dateien: all, teil: part.index, anzahl: part.total, messdatei: werkzeugMessdatei() });
}

function toolTests(plan, part, listFile) {
  const files = toolTestFiles(plan, part, listFile);
  if (files === null) return EXIT_FAILURE;
  if (files.length === 0) {
    console.log(`Werkzeugtests Teil ${part?.index}/${part?.total}: keine Datei der Liste in diesem Teil.`);
    return 0;
  }
  mkdirSync(PROTOCOL_DIR, { recursive: true });
  const listed = new Set(plan.liste);
  const guarded = files.filter((file) => !listed.has(file));
  const direct = files.filter((file) => !guarded.includes(file));
  const report = part === undefined ? undefined : partReportPath(part);
  const directStatus = direct.length === 0 ? 0 : runToolBank(direct, { laufzeit: report });
  const guardedStatus =
    guarded.length === 0 ? 0 : guardedRun({ files: guarded, runBank: runToolBank, laufzeitBericht: report });
  return directStatus === 0 ? guardedStatus : directStatus;
}

function parseOptions() {
  const { values } = parseArgs({
    options: {
      basis: { type: "string" },
      "vor-push": { type: "boolean", default: false },
      "ohne-werkzeugtests": { type: "boolean", default: false },
      "alle-werkzeugtests": { type: "boolean", default: false },
      "werkzeugtests-aus-liste": { type: "boolean", default: false },
      "werkzeugtests-gewollt": { type: "boolean", default: false },
      "teile-planen": { type: "boolean", default: false },
      "fuer-ereignis": { type: "string" },
      werkzeugteil: { type: "string" },
      werkzeugdateien: { type: "string" },
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
  if (!runsToolTests(options)) return affectedStatus;
  const plan = await toolTestPlan(options);
  if (plan.art === NO_TOOL_TESTS) return affectedStatus;
  const toolStatus = toolTests(plan);
  return affectedStatus === 0 ? toolStatus : affectedStatus;
}

async function partRun(options, part) {
  const plan = await toolTestPlan(options);
  if (plan.art === NO_TOOL_TESTS) {
    console.log(
      `Werkzeugtests Teil ${part.index}/${part.total}: keine Änderung außerhalb von src/ und test/ (plaene/ zählt wie src/).`,
    );
    return 0;
  }
  return toolTests(plan, part, options.werkzeugdateien);
}

async function announceToolTests(options) {
  const plan = await toolTestPlan(options);
  console.log(plan.art === NO_TOOL_TESTS ? TOOL_TESTS_NOT_WANTED : TOOL_TESTS_WANTED);
  return 0;
}

async function announceParts(options) {
  const total = werkzeugTeilzahl(expectedToolTestFiles(await toolTestPlan(options)));
  console.log(JSON.stringify(Array.from({ length: total }, (_leer, index) => index + 1)));
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

function expectedToolTestFiles(plan) {
  if (plan.art === NO_TOOL_TESTS) return [];
  if (plan.art === LIST_TOOL_TESTS) return plan.dateien;
  return globSync(TOOL_TEST_GLOB).sort();
}

function emptyGlobFindings(plan, expected) {
  if (expected.length > 0 || plan.art !== ALL_TOOL_TESTS) return [];
  return [`${TOOL_TEST_GLOB} findet keine Werkzeug-Testdatei.`];
}

async function checkParts(options) {
  const plan = await toolTestPlan(options);
  const expected = expectedToolTestFiles(plan);
  const findings = [
    ...emptyGlobFindings(plan, expected),
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
  if (options.werkzeugdateien !== undefined && options.werkzeugteil === undefined) {
    return "--werkzeugdateien gehört zu --werkzeugteil.";
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
  if (options["teile-planen"]) return announceParts(options);
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

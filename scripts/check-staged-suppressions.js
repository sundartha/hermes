#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUPPRESSIONS_REL = "eslint-suppressions.json";
const LEGACY_EXCEPTIONS_REL = "eslint-legacy-exceptions.json";
const EMPTY_SUPPRESSIONS_REL = "eslint-suppressions.empty.json";
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRUNE_COMMAND = "npx eslint --prune-suppressions";
const NO_VERIFY_COMMAND = "git commit --no-verify";
const LOG_PREFIX = "[check-staged-suppressions]";
const CLI_ARGS_OFFSET = 2;

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isCalendarDate(value) {
  if (!isNonEmptyText(value) || !CALENDAR_DATE_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isWellFormedFindings(findings) {
  if (findings === null || typeof findings !== "object" || Array.isArray(findings)) return false;
  const counts = Object.values(findings);
  if (counts.length === 0) return false;
  return counts.every(isPositiveInteger);
}

function excusesLegacy(entry) {
  if (!entry) return false;
  return (
    isNonEmptyText(entry.reason) && isCalendarDate(entry.date) && isWellFormedFindings(entry.findings)
  );
}

export function findSuppressedStagedFiles({
  stagedFiles,
  suppressions,
  legacyExceptions = {},
}) {
  const offenders = [];
  for (const file of stagedFiles) {
    if (excusesLegacy(legacyExceptions[file])) continue;
    const rulesForFile = suppressions[file];
    if (!rulesForFile) continue;
    const ruleCounts = Object.entries(rulesForFile).map(([rule, entry]) => ({
      rule,
      count: entry.count,
    }));
    if (ruleCounts.length > 0) offenders.push({ file, ruleCounts });
  }
  return offenders;
}

const FINDING_KEY_SEPARATOR = " :: ";
const MAX_REPORTED_DIFFERENCES = 3;

export function findingTally(messages) {
  const tally = new Map();
  for (const message of messages) {
    const key = `${message.ruleId}${FINDING_KEY_SEPARATOR}${message.message}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return tally;
}

export function tallyDifferences(before, after) {
  const differences = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const countBefore = before.get(key) ?? 0;
    const countAfter = after.get(key) ?? 0;
    if (countBefore !== countAfter) {
      differences.push({ key, countBefore, countAfter });
    }
  }
  return differences;
}

function describeDifference({ key, countBefore, countAfter }) {
  const separatorIndex = key.indexOf(FINDING_KEY_SEPARATOR);
  const rule = key.slice(0, separatorIndex);
  const message = key.slice(separatorIndex + FINDING_KEY_SEPARATOR.length);
  return `${countBefore} -> ${countAfter}  ${rule}: ${message}`;
}

function describeDifferences(differences) {
  const shown = differences
    .slice(0, MAX_REPORTED_DIFFERENCES)
    .map((difference) => `Befunde bewegt: ${describeDifference(difference)}`);
  const hidden = differences.length - shown.length;
  return hidden > 0 ? [...shown, `... und ${hidden} weitere`] : shown;
}

async function reasonsToReject(file, readFindings) {
  let differences;
  try {
    const { before, after } = await readFindings(file);
    differences = tallyDifferences(findingTally(before), findingTally(after));
  } catch (err) {
    return [`nicht pruefbar (fail-closed): ${err.message}`];
  }
  return differences.length === 0 ? null : describeDifferences(differences);
}

export async function findChangedFindings({ candidates, readFindings }) {
  const offenders = [];
  for (const candidate of candidates) {
    const reasons = await reasonsToReject(candidate.file, readFindings);
    if (reasons) offenders.push({ ...candidate, reasons });
  }
  return offenders;
}

function tallyFromFindings(findings) {
  return new Map(Object.entries(findings));
}

function findingsFromTally(tally) {
  const findings = {};
  for (const key of [...tally.keys()].sort()) findings[key] = tally.get(key);
  return findings;
}

export async function findPinMismatches({ stagedFiles, legacyExceptions, readStagedFindings }) {
  const offenders = [];
  for (const file of stagedFiles) {
    const entry = legacyExceptions[file];
    if (!excusesLegacy(entry)) continue;
    const pin = tallyFromFindings(entry.findings);
    let actual;
    try {
      actual = findingTally(await readStagedFindings(file));
    } catch (err) {
      offenders.push({ file, reasons: [`nicht pruefbar (fail-closed): ${err.message}`] });
      continue;
    }
    const differences = tallyDifferences(pin, actual);
    if (differences.length === 0) continue;
    offenders.push({
      file,
      reasons: describeDifferences(differences),
      correctedFindings: findingsFromTally(actual),
    });
  }
  return offenders;
}

function formatOffender({ file, ruleCounts, reasons = [] }) {
  const rulesText = ruleCounts
    .map(({ rule, count }) => `${rule}: ${count}`)
    .join(", ");
  const reasonLines = reasons.map((reason) => `\n     ${reason}`).join("");
  return `  ${file} -> ${rulesText}${reasonLines}`;
}

const WAY_OUT_LINES = [
  "Eine Aenderung, die die Befundmenge NICHT bewegt, geht ohne Aufraeumen durch -",
  "hier ist sie bewegt (Zeilen oben).",
  `Aufraeumen (Normalfall): Verstoesse beheben, danach: ${PRUNE_COMMAND}`,
  `Waere das Aufraeumen ein eigener Umbau: die Datei in ${LEGACY_EXCEPTIONS_REL}`,
  "eintragen, mit reason (warum sie liegen bleibt) und date (YYYY-MM-DD).",
  "Dieser Eintrag braucht die Freigabe des Eigentuemers - kein Bau-Agent setzt",
  "einen, um weiterzukommen. Der Grund muss sagen, WARUM das Aufraeumen",
  "gefaehrlich waere, nicht dass es Arbeit ist.",
  `"${NO_VERIFY_COMMAND}" ist keine Option.`,
];

function logLine(text) {
  console.error(`${LOG_PREFIX} ${text}`);
}

function printReport(offenders) {
  console.error("");
  logLine("Commit abgebrochen: folgende vorgemerkte Dateien tragen");
  logLine(`noch Eintraege in ${SUPPRESSIONS_REL} UND ihre Lint-Befunde`);
  logLine("haben sich durch die Aenderung bewegt:");
  for (const offender of offenders) console.error(formatOffender(offender));
  console.error("");
  for (const line of WAY_OUT_LINES) logLine(line);
}

const CORRECTED_FINDINGS_JSON_INDENT = 2;
const CORRECTED_FINDINGS_LINE_PREFIX = "       ";

function formatCorrectedFindings(correctedFindings) {
  const json = JSON.stringify(correctedFindings, null, CORRECTED_FINDINGS_JSON_INDENT);
  const lines = json.split("\n");
  const indentedLines = lines.map((line) => `${CORRECTED_FINDINGS_LINE_PREFIX}${line}`);
  return indentedLines.join("\n");
}

function formatPinOffender({ file, reasons = [], correctedFindings }) {
  const reasonLines = reasons.map((reason) => `\n     ${reason}`).join("");
  const correctedBlock = correctedFindings
    ? `\n     Korrigierter findings-Block fuer ${LEGACY_EXCEPTIONS_REL}:\n${formatCorrectedFindings(correctedFindings)}`
    : "";
  return `  ${file}${reasonLines}${correctedBlock}`;
}

const PIN_WAY_OUT_LINES = [
  "Ein Altlast-Eintrag entschuldigt nur GENAU die gepinnte Befundmenge - sie hat",
  "sich bewegt (Zeilen oben). Weniger Befunde brechen genauso wie mehr: ein zu",
  "hoch stehender Pin ist der Spielraum, in dem spaeter ein neuer Verstoss",
  "unbemerkt Platz faende.",
  `Ersetze den findings-Block dieser Datei in ${LEGACY_EXCEPTIONS_REL} durch den`,
  "oben ausgegebenen, fertigen JSON-Block.",
  `"${NO_VERIFY_COMMAND}" ist keine Option.`,
];

function printPinMismatchReport(offenders) {
  console.error("");
  logLine("Commit abgebrochen: folgende Dateien auf der Altlast-Liste tragen");
  logLine("einen Pin, der nicht mehr zur tatsaechlichen, ungefilterten");
  logLine("Befundmenge ihrer vorgemerkten Fassung passt:");
  for (const offender of offenders) console.error(formatPinOffender(offender));
  console.error("");
  for (const line of PIN_WAY_OUT_LINES) logLine(line);
}

function readRepoFile(relativePath) {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

export function loadLegacyExceptions(readText = readRepoFile) {
  return JSON.parse(readText(LEGACY_EXCEPTIONS_REL));
}

const HEAD_CONTENT_PREFIX = "HEAD:";
const STAGED_CONTENT_PREFIX = ":";
const GIT_SHOW_MAX_BUFFER_BYTES = 33554432;

function readGitContent(revisionAndPath) {
  return execFileSync("git", ["show", revisionAndPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: GIT_SHOW_MAX_BUFFER_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function makeUnfilteredLinter() {
  const { ESLint } = await import("eslint");
  const eslint = new ESLint({
    cwd: REPO_ROOT,
    suppressionsLocation: resolve(REPO_ROOT, EMPTY_SUPPRESSIONS_REL),
  });
  return async function lintContent(code, file) {
    const results = await eslint.lintText(code, {
      filePath: file,
      warnIgnored: false,
    });
    if (results.length !== 1) {
      throw new Error(`eslint hat ${file} nicht gelintet (ignoriert oder unbekannte Endung)`);
    }
    const [result] = results;
    const messages = [...result.messages, ...(result.suppressedMessages ?? [])];
    const parseError = messages.find((message) => message.fatal);
    if (parseError) {
      throw new Error(`eslint kann ${file} nicht lesen: ${parseError.message}`);
    }
    return messages;
  };
}

async function makeGitFindingsReader() {
  const lintContent = await makeUnfilteredLinter();
  return async function readFindings(file) {
    const headCode = readGitContent(`${HEAD_CONTENT_PREFIX}${file}`);
    const stagedCode = readGitContent(`${STAGED_CONTENT_PREFIX}${file}`);
    return {
      before: await lintContent(headCode, file),
      after: await lintContent(stagedCode, file),
    };
  };
}

async function makeStagedFindingsReader() {
  const lintContent = await makeUnfilteredLinter();
  return async function readStagedFindings(file) {
    const stagedCode = readGitContent(`${STAGED_CONTENT_PREFIX}${file}`);
    return lintContent(stagedCode, file);
  };
}

async function runCli() {
  const stagedFiles = process.argv.slice(CLI_ARGS_OFFSET);
  if (stagedFiles.length === 0) return 0;
  const suppressions = JSON.parse(readRepoFile(SUPPRESSIONS_REL));
  const legacyExceptions = loadLegacyExceptions();
  const candidates = findSuppressedStagedFiles({ stagedFiles, suppressions, legacyExceptions });
  const pinCandidates = stagedFiles.filter((file) => excusesLegacy(legacyExceptions[file]));
  if (candidates.length === 0 && pinCandidates.length === 0) return 0;

  const changedOffenders =
    candidates.length === 0
      ? []
      : await findChangedFindings({ candidates, readFindings: await makeGitFindingsReader() });
  const pinOffenders =
    pinCandidates.length === 0
      ? []
      : await findPinMismatches({
          stagedFiles: pinCandidates,
          legacyExceptions,
          readStagedFindings: await makeStagedFindingsReader(),
        });

  if (changedOffenders.length === 0 && pinOffenders.length === 0) return 0;
  if (changedOffenders.length > 0) printReport(changedOffenders);
  if (pinOffenders.length > 0) printPinMismatchReport(pinOffenders);
  return 1;
}

const isMain =
  fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (isMain) {
  try {
    process.exit(await runCli());
  } catch (err) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ${err.message}`);
    process.exit(1);
  }
}

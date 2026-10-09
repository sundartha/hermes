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
    if (message.ruleId === null) continue;
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

function tallyIncreases(before, after) {
  return tallyDifferences(before, after).filter(
    ({ countBefore, countAfter }) => countAfter > countBefore,
  );
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
    differences = tallyIncreases(findingTally(before), findingTally(after));
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
    const differences = tallyIncreases(pin, actual);
    if (differences.length === 0) continue;
    offenders.push({ file, reasons: describeDifferences(differences) });
  }
  return offenders;
}

function suppressionCounts(suppressions) {
  return Object.entries(suppressions).flatMap(([file, rules]) =>
    Object.entries(rules).map(([rule, entry]) => ({ file, rule, count: entry.count })),
  );
}

function countIn(suppressions, file, rule) {
  const rules = suppressions[file] ?? {};
  return rules[rule]?.count ?? 0;
}

export function findRaisedSuppressions(before, after) {
  return suppressionCounts(after)
    .map(({ file, rule, count }) => ({ file, rule, countBefore: countIn(before, file, rule), countAfter: count }))
    .filter(({ countBefore, countAfter }) => !(countAfter <= countBefore));
}

function formatOffender({ file, ruleCounts, reasons = [] }) {
  const rulesText = ruleCounts
    .map(({ rule, count }) => `${rule}: ${count}`)
    .join(", ");
  const reasonLines = reasons.map((reason) => `\n     ${reason}`).join("");
  return `  ${file} -> ${rulesText}${reasonLines}`;
}

const WAY_OUT_LINES = [
  "Eine Aenderung, die keinen Befund hinzufuegt, geht durch; weniger Befunde sind",
  "erlaubt - hier sind Befunde dazugekommen (Zeilen oben).",
  "Die neuen Verstoesse beheben. Fallen dabei Befunde weg, darf die Zahl dieser",
  `Datei in ${SUPPRESSIONS_REL} sinken; sie muss es nicht.`,
  `Keine Zahl in ${SUPPRESSIONS_REL} oder ${LEGACY_EXCEPTIONS_REL} darf steigen.`,
  `"${NO_VERIFY_COMMAND}" ist keine Option.`,
];

function logLine(text) {
  console.error(`${LOG_PREFIX} ${text}`);
}

function printReport(offenders) {
  console.error("");
  logLine("Commit abgebrochen: folgende vorgemerkte Dateien tragen");
  logLine(`noch Eintraege in ${SUPPRESSIONS_REL} UND ihre Lint-Befunde`);
  logLine("durch die Aenderung neue Befunde bekommen:");
  for (const offender of offenders) console.error(formatOffender(offender));
  console.error("");
  for (const line of WAY_OUT_LINES) logLine(line);
}

function formatPinOffender({ file, reasons = [] }) {
  const reasonLines = reasons.map((reason) => `\n     ${reason}`).join("");
  return `  ${file}${reasonLines}`;
}

const PIN_WAY_OUT_LINES = [
  "Ein Altlast-Eintrag entschuldigt hoechstens die gepinnte Befundmenge - hier",
  "sind Befunde dazugekommen (Zeilen oben). Weniger Befunde sind erlaubt.",
  "Die neuen Verstoesse beheben; der Pin steigt nicht.",
  `"${NO_VERIFY_COMMAND}" ist keine Option.`,
];

function printPinMismatchReport(offenders) {
  console.error("");
  logLine("Commit abgebrochen: folgende Dateien auf der Altlast-Liste haben");
  logLine("mehr ungefilterte Befunde in ihrer vorgemerkten Fassung, als ihr");
  logLine("Pin erlaubt:");
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

const BASIS_OPTION = "--basis";
const HEAD_REVISION = "HEAD";
const STAGED_REVISION = "";

function suppressionsAt(revision) {
  let text;
  try {
    text = readGitContent(`${revision}:${SUPPRESSIONS_REL}`);
  } catch {
    return {};
  }
  return JSON.parse(text);
}

function printRaisedReport(raised) {
  console.error("");
  logLine(`Abgebrochen: in ${SUPPRESSIONS_REL} steigen Zahlen:`);
  for (const { file, rule, countBefore, countAfter } of raised) {
    console.error(`  ${file} -> ${rule}: ${countBefore} -> ${countAfter}`);
  }
  console.error("");
  logLine("Die Liste wird nur kleiner. Den neuen Verstoss beheben, statt ihn zu unterdruecken.");
  logLine(`"${NO_VERIFY_COMMAND}" ist keine Option.`);
}

function raisedSuppressionsStatus(beforeRevision, afterRevision) {
  const raised = findRaisedSuppressions(suppressionsAt(beforeRevision), suppressionsAt(afterRevision));
  if (raised.length === 0) return 0;
  printRaisedReport(raised);
  return 1;
}

function basisStatus(basis) {
  if (!isNonEmptyText(basis)) throw new Error(`${BASIS_OPTION} braucht einen Commit`);
  return raisedSuppressionsStatus(basis, HEAD_REVISION);
}

async function runCli() {
  const args = process.argv.slice(CLI_ARGS_OFFSET);
  if (args[0] === BASIS_OPTION) return basisStatus(args[1]);
  if (raisedSuppressionsStatus(HEAD_REVISION, STAGED_REVISION) !== 0) return 1;
  return stagedFilesStatus(args);
}

async function stagedFilesStatus(stagedFiles) {
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

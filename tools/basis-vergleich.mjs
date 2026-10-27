import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ESLint } from "eslint";

import { knotenSchluessel, pfadAusSchluessel, pfadInDerWurzel } from "./eslint-rules/bestand.js";
import { importeMitPlatzhalter } from "./eslint-rules/fester-importpfad.js";
import { quelltextLesestellen } from "./eslint-rules/kein-quelltext-als-text.js";
import { speicherAttrappen } from "./eslint-rules/keine-speicher-attrappe.js";
import { instructionFindings, lineFingerprint, rootFindings } from "./anweisungen-befunde.mjs";
import { aenderungenSeit, legeWorktreeAn } from "./auftrag/git.mjs";
import { MELDUNG, zweckBlock } from "./auftrag/zweck.mjs";
import { fileAt } from "./pruefungen-messen.mjs";
import { isCommit } from "./ts-dateien.mjs";
import { inhalt, umbenennungsPaare } from "./umbenennung.mjs";
import {
  aufgeteilt,
  gewachsen,
  gezaehlt,
  paarZurueck,
  pfadZurueck,
  rueckfuehrung,
  teilZurueck,
  unveraendert,
} from "./bestand-rueckfuehrung.mjs";
import { selbstpruefungen } from "./eslint-rules/keine-selbstpruefung.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const NODE_BIN_DIR = join(REPO_ROOT, "node_modules/.bin");
const BASELINE_DIR = "tools/basis";
const NESTED_CHECKOUTS_DIRECTORY = ".claude/worktrees";
const SEMGREP_COMMAND = "semgrep";
const SEMGREP_RULES_FILE = "tools/basis/semgrep-regeln.json";
const SEMGREP_WITHOUT_RULE_TIMEOUT = "0";
const SEMGREP_SINGLE_THREAD = "1";
const JSCPD_REPORT_FILE = "jscpd-report.json";
const JSCPD_CONFIG_FILE = ".jscpd.json";
const JSCPD_PACKAGE_FILE = join(REPO_ROOT, "node_modules/jscpd/package.json");
const KNIP_EXIT_ISSUES_FOUND = 1;
const KNIP_ROW_FIELDS_WITHOUT_ISSUES = new Set(["file", "owners"]);
const KEY_SEPARATOR = "|";
const SYMBOL_SEPARATOR = "+";
const WHITESPACE_PATTERN = /\s+/g;
const BYTES_PER_KIBIBYTE = 1024;
const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;
const MAX_TOOL_OUTPUT_MEBIBYTES = 512;
const MAX_ERROR_LINES = 20;
const MAX_POSITIONALS = 1;
const JSON_INDENT = 2;
const SHORTEN_OPTION = "basis-kuerzen";
const CREATE_OPTION = "basis-anlegen";
const PER_FOLDER_OPTION = "je-ordner";
const BASIS_OPTION = "basis";
const RENAME_OPTION = "umbenennung-nachziehen";
const COLLECTOR_PLUGIN = "basis-vergleich";
const ROOT_FOLDER_LABEL = ".";
const PATH_SEPARATOR = "/";
const TEST_FILES = ["test/**"];
const LESSONS_FILE = "docs/lessons.md";
const FORMER_LESSONS_FILE = "tasks/lessons.md";
const LINE_BREAK = "\n";
const EXIT_FAILURE = 1;

function runTool(command, args, root) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_TOOL_OUTPUT_MEBIBYTES * BYTES_PER_MEBIBYTE,
  });
  if (result.error) throw new Error(`${command} ließ sich nicht starten: ${result.error.message}`);
  return result;
}

function runNodeTool(name, args, root) {
  return runTool(process.execPath, [join(NODE_BIN_DIR, name), ...args], root);
}

function toolFailure(name, { status, stderr }) {
  const lines = stderr.split("\n").filter((line) => line.trim() !== "");
  return new Error(
    `${name} ist mit Exit ${status} gescheitert:\n${lines.slice(-MAX_ERROR_LINES).join("\n")}`,
  );
}

function fingerprintWithoutWhitespace(text) {
  return lineFingerprint(text.replace(WHITESPACE_PATTERN, ""));
}

function findingKey(parts) {
  return parts.join(KEY_SEPARATOR);
}

function withLine(file, line) {
  return line === undefined ? file : `${file}:${line}`;
}

function jscpdClone(root, file) {
  return { ...file, name: relative(root, resolve(root, file.name)) };
}

function jscpdFinding(root, { firstFile, secondFile, tokens }) {
  const first = jscpdClone(root, firstFile);
  const second = jscpdClone(root, secondFile);
  const files = [first.name, second.name].sort();
  return {
    key: findingKey([...files, `${tokens}`]),
    location: `${first.name}:${first.start}-${first.end} gleicht ${second.name}:${second.start}-${second.end} (${tokens} Tokens)`,
  };
}

const JSCPD_PAIR_PARTS = 2;

function jscpdPair(key) {
  return key.split(KEY_SEPARATOR).slice(0, JSCPD_PAIR_PARTS).join(KEY_SEPARATOR);
}

function jscpdTokens(key) {
  return Number(key.split(KEY_SEPARATOR)[JSCPD_PAIR_PARTS]);
}

function byTokens(left, right) {
  return jscpdTokens(left) - jscpdTokens(right);
}

function jscpdShrunk(findings, freeKeys, unchangedKnownPair) {
  const free = freeKeys.toSorted(byTokens);
  const shrunk = { covered: [], keys: [] };
  const cover = (finding, fits) => {
    const index = free.findIndex((key) => jscpdPair(key) === jscpdPair(finding.key) && fits(key));
    if (index === -1) return;
    shrunk.covered.push(finding);
    shrunk.keys.push(...free.splice(index, 1));
  };
  const largestFirst = findings.toSorted((left, right) => byTokens(right.key, left.key));
  for (const finding of largestFirst) cover(finding, (key) => jscpdTokens(finding.key) <= jscpdTokens(key));
  for (const finding of largestFirst) {
    if (!shrunk.covered.includes(finding) && unchangedKnownPair(finding.key)) cover(finding, () => true);
  }
  return shrunk;
}

function jscpdVersion() {
  return JSON.parse(readFileSync(JSCPD_PACKAGE_FILE, "utf8")).version;
}

function jscpdFindings(root) {
  const outputDir = mkdtempSync(join(tmpdir(), "basis-vergleich-jscpd-"));
  try {
    const args = [".", "--reporters", "json", "--output", outputDir, "--silent"];
    const result = runNodeTool("jscpd", args, root);
    if (result.status !== 0) throw toolFailure("jscpd", result);
    const report = JSON.parse(readFileSync(join(outputDir, JSCPD_REPORT_FILE), "utf8"));
    return report.duplicates.map((clone) => jscpdFinding(root, clone));
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function knipSymbol(issue) {
  if (Array.isArray(issue)) return issue.map(knipSymbol).join(SYMBOL_SEPARATOR);
  return issue.namespace ? `${issue.namespace}.${issue.name}` : issue.name;
}

function knipFinding(file, type, issue) {
  const symbol = knipSymbol(issue);
  const line = Array.isArray(issue) ? issue[0]?.line : issue.line;
  return {
    key: findingKey([type, file, symbol]),
    location: `${withLine(file, line)} ${type} ${symbol}`,
  };
}

function knipRowFindings(row) {
  return Object.entries(row)
    .filter(([type, issues]) => !KNIP_ROW_FIELDS_WITHOUT_ISSUES.has(type) && Array.isArray(issues))
    .flatMap(([type, issues]) => issues.map((issue) => knipFinding(row.file, type, issue)));
}

function knipFindings(root) {
  const result = runNodeTool("knip", ["--reporter", "json", "--no-progress"], root);
  if (result.status !== 0 && result.status !== KNIP_EXIT_ISSUES_FOUND) {
    throw toolFailure("knip", result);
  }
  return JSON.parse(result.stdout).issues.flatMap(knipRowFindings);
}

function knipBack(key, back) {
  const [type, file, ...symbol] = key.split(KEY_SEPARATOR);
  const rest = symbol.join(KEY_SEPARATOR);
  return findingKey([type, back(file), rest === file ? back(file) : rest]);
}

function semgrepVersion(root) {
  const result = runTool(SEMGREP_COMMAND, ["--version"], root);
  if (result.status !== 0) throw toolFailure("semgrep --version", result);
  return result.stdout.trim();
}

function semgrepFinding(root, { check_id: ruleId, path, start, end }) {
  const snippet = readFileSync(join(root, path))
    .subarray(start.offset, end.offset)
    .toString("utf8");
  return {
    key: findingKey([ruleId, path, fingerprintWithoutWhitespace(snippet)]),
    location: `${withLine(path, start.line)} ${ruleId}`,
  };
}

function semgrepFindings(root) {
  const args = [
    "scan",
    "--config",
    SEMGREP_RULES_FILE,
    "--json",
    "--metrics",
    "off",
    "--disable-version-check",
    "--timeout",
    SEMGREP_WITHOUT_RULE_TIMEOUT,
    "--jobs",
    SEMGREP_SINGLE_THREAD,
    "--exclude",
    NESTED_CHECKOUTS_DIRECTORY,
    ".",
  ];
  const result = runTool(SEMGREP_COMMAND, args, root);
  if (result.status !== 0) throw toolFailure("semgrep", result);
  const report = JSON.parse(result.stdout);
  if (report.errors.length > 0) {
    const messages = report.errors.map((error) => `${error.path ?? ""} ${error.message}`.trim());
    throw new Error(`semgrep meldet Fehler beim Prüfen:\n${messages.join("\n")}`);
  }
  return report.results.map((match) => semgrepFinding(root, match));
}

function collectorRule(keysOf) {
  return {
    meta: { schema: [] },
    create(context) {
      return {
        Program() {
          const file = pfadInDerWurzel(context.cwd, context.filename);
          for (const { key, loc } of keysOf(context, file)) context.report({ loc, message: key });
        },
      };
    },
  };
}

function collectorConfig(ruleName, { keysOf, files }) {
  const plugin = { rules: { [ruleName]: collectorRule(keysOf) } };
  return {
    ...(files !== undefined && { files }),
    plugins: { [COLLECTOR_PLUGIN]: plugin },
    rules: { [`${COLLECTOR_PLUGIN}/${ruleName}`]: "error" },
  };
}

function lintResultFindings(root, ruleId, { filePath, messages }) {
  const file = pfadInDerWurzel(root, filePath);
  const fatal = messages.find((message) => message.fatal);
  if (fatal !== undefined) throw new Error(`ESLint kann ${file} nicht lesen: ${fatal.message}`);
  return messages
    .filter((message) => message.ruleId === ruleId)
    .map(({ message, line }) => ({ key: message, location: `${file}:${line}` }));
}

export async function eslintCollectorFindings(root, ruleName, collector) {
  const ruleId = `${COLLECTOR_PLUGIN}/${ruleName}`;
  const eslint = new ESLint({
    cwd: root,
    applySuppressions: false,
    overrideConfig: collectorConfig(ruleName, collector),
    ruleFilter: (rule) => rule.ruleId === ruleId,
  });
  const results = await eslint.lintFiles(["."]);
  return results.flatMap((result) => lintResultFindings(root, ruleId, result));
}

function nodeKeys(nodesOf) {
  return (context, file) => {
    const { sourceCode } = context;
    return nodesOf(sourceCode, file).map((node) => ({
      key: knotenSchluessel(sourceCode, file, node),
      loc: node.loc,
    }));
  };
}

function testRuleFindings(ruleName, nodesOf) {
  return (root) =>
    eslintCollectorFindings(root, ruleName, { keysOf: nodeKeys(nodesOf), files: TEST_FILES });
}

function misplacedLessons(root) {
  if (!existsSync(join(root, FORMER_LESSONS_FILE))) return [];
  return [
    {
      key: findingKey([FORMER_LESSONS_FILE, "alter-ort"]),
      location: `${FORMER_LESSONS_FILE} existiert; Lehren stehen nur in ${LESSONS_FILE}`,
      always: true,
    },
  ];
}

function lessonsFindings(root) {
  const path = join(root, LESSONS_FILE);
  if (!existsSync(path)) {
    const missing = {
      key: findingKey([LESSONS_FILE, "fehlt"]),
      location: `${LESSONS_FILE} fehlt`,
      always: true,
    };
    return [missing, ...misplacedLessons(root)];
  }
  const lines = readFileSync(path, "utf8").split(LINE_BREAK);
  const findings = lines
    .map((line, index) => ({ text: line.trim(), number: index + 1 }))
    .filter(({ text }) => text !== "")
    .map(({ text, number }) => ({
      key: findingKey([LESSONS_FILE, lineFingerprint(text)]),
      location: `${LESSONS_FILE}:${number}`,
    }));
  return [...findings, ...misplacedLessons(root)];
}

function keyPart(index) {
  return (key) => key.split(KEY_SEPARATOR)[index];
}

const PATH_KEYED = { path: pfadAusSchluessel, back: pfadZurueck };
const PER_FILE = { ...PATH_KEYED, findingPerFile: true };

export const TOOLS = {
  jscpd: {
    findings: jscpdFindings,
    version: jscpdVersion,
    path: keyPart(0),
    back: paarZurueck(JSCPD_PAIR_PARTS),
    shrunk: jscpdShrunk,
    renamedBasis: true,
    zweck: MELDUNG.JSCPD,
    findingPerFile: true,
  },
  knip: { findings: knipFindings, path: keyPart(1), back: knipBack, zweck: "basis/knip" },
  semgrep: {
    findings: semgrepFindings,
    version: semgrepVersion,
    path: keyPart(1),
    back: teilZurueck(1),
    findingPerFile: true,
    zweck: "basis/semgrep",
  },
  "quelltext-als-text": {
    findings: testRuleFindings("quelltext-als-text", quelltextLesestellen),
    ...PER_FILE,
    zweck: "basis/quelltext-als-text",
  },
  selbstpruefung: {
    findings: testRuleFindings("selbstpruefung", selbstpruefungen),
    ...PER_FILE,
    zweck: "basis/selbstpruefung",
  },
  "fester-importpfad": {
    findings: testRuleFindings("fester-importpfad", importeMitPlatzhalter),
    ...PER_FILE,
    zweck: "basis/fester-importpfad",
  },
  "keine-speicher-attrappe": {
    findings: testRuleFindings("keine-speicher-attrappe", speicherAttrappen),
    ...PER_FILE,
    zweck: "basis/keine-speicher-attrappe",
  },
  lessons: { findings: lessonsFindings, ...PER_FILE, zweck: "basis/lessons" },
  anweisungen: { findings: instructionFindings, ...PATH_KEYED, zweck: "basis/anweisungen" },
  wurzel: { findings: rootFindings, ...PATH_KEYED, zweck: "basis/wurzel" },
};

export const VERSIONSWECHSEL = "basis/versionswechsel";

class VersionFailure extends Error {}

function baselineFile(toolName) {
  return join(BASELINE_DIR, `${toolName}.json`);
}

function readBaseline(root, toolName) {
  const path = join(root, baselineFile(toolName));
  if (!existsSync(path)) {
    throw new Error(
      `${baselineFile(toolName)} fehlt. Eine neue Basislinie legt „node tools/basis-vergleich.mjs ${toolName} --${CREATE_OPTION}“ an.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function checkBasis(basis) {
  if (!isCommit(basis)) throw new Error(`Die Basis ${basis} ist kein Commit in diesem Repo.`);
}

function baselineAt(basis, toolName) {
  const text = fileAt(basis, baselineFile(toolName));
  return text === undefined ? undefined : JSON.parse(text);
}

function pureRenames(basis) {
  return umbenennungsPaare({ von: basis }).filter(
    ({ alt, neu }) => inhalt(basis, alt) === inhalt(undefined, neu),
  );
}

function onlyUnchangedFiles(root, basis, renames) {
  const renamed = new Set(renames.flatMap(({ alt, neu }) => [alt, neu]));
  const changed = new Set(changedSince(root, basis).filter((path) => !renamed.has(path)));
  return (key) => jscpdPair(key).split(KEY_SEPARATOR).every((path) => !changed.has(path));
}

function unchangedKnownPair({ root, basis, toolName, tool }, baseline) {
  const none = () => false;
  if (basis === undefined || tool.shrunk === undefined) return none;
  checkBasis(basis);
  const before = baselineAt(basis, toolName);
  if (before === undefined || before.version !== baseline.version) return none;
  const unchanged = onlyUnchangedFiles(root, basis, []);
  if (!unchanged(JSCPD_CONFIG_FILE)) return none;
  const onBasis = new Set(before.befunde.map(jscpdPair));
  return (key) => onBasis.has(jscpdPair(key)) && unchanged(key);
}

function onFirstUse(build) {
  let decide;
  return (key) => (decide ??= build())(key);
}

async function renamedBasisFindings({ root, basis, tool }) {
  if (basis === undefined || tool.renamedBasis !== true) return [];
  checkBasis(basis);
  const renames = pureRenames(basis);
  if (renames.length === 0) return [];
  const directory = mkdtempSync(join(tmpdir(), "basis-vergleich-umbenannt-"));
  const remove = legeWorktreeAn(basis, directory, root);
  try {
    for (const { alt, neu } of renames) renameSync(join(directory, alt), join(directory, neu));
    writeFileSync(join(directory, JSCPD_CONFIG_FILE), readFileSync(join(root, JSCPD_CONFIG_FILE)));
    const keys = frozenFindings(await tool.findings(directory)).map(findingKeyOf);
    return keys.filter(onlyUnchangedFiles(root, basis, renames));
  } finally {
    remove();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function grownEntries({ basis, toolName, tool }, baseline) {
  if (basis === undefined) return [];
  checkBasis(basis);
  const before = baselineAt(basis, toolName);
  if (before === undefined) {
    console.log(`${baselineFile(toolName)} gibt es auf der Basis ${basis} noch nicht.`);
    return [];
  }
  if (before.version !== baseline.version) {
    console.log(
      `${baselineFile(toolName)} gilt für eine andere Version als auf der Basis ${basis}; nach einem Versionswechsel wird sie neu angelegt.`,
    );
    return [];
  }
  const back = await rueckfuehrung(basis);
  return gewachsen({
    jetzt: baseline.befunde,
    vorher: before.befunde,
    zurueck: (key) => tool.back(key, back),
  });
}

function changedSince(root, basis) {
  return aenderungenSeit(basis, root).map(({ pfad }) => pfad);
}

function splitWidening({ root, basis, tool }, grown, exact) {
  if (grown.length === 0 || tool.findingPerFile !== true) return { widened: [], grown };
  const changed = changedSince(root, basis);
  const touches = (entry) => changed.some((path) => entry.schluessel.includes(path));
  const { innerhalb, darueber } = aufgeteilt(
    grown.filter((entry) => !touches(entry)),
    exact,
    (entry) => entry.schluessel,
  );
  return { widened: innerhalb, grown: [...grown.filter(touches), ...darueber] };
}

function listGrew({ basis, toolName }, baseline) {
  const before = baselineAt(basis, toolName);
  return before === undefined || baseline.befunde.length > before.befunde.length;
}

function splitRenamed(grown, renamed) {
  if (grown.length === 0 || renamed.length === 0) return { fromRenames: [], grown };
  const { innerhalb, darueber } = aufgeteilt(grown, renamed, (entry) => entry.schluessel);
  return { fromRenames: innerhalb, grown: darueber };
}

function reportFromRenames({ toolName, basis }, fromRenames) {
  if (fromRenames.length === 0) return;
  console.log(
    `${fromRenames.length} Einträge in ${baselineFile(toolName)} sind neu gegenüber der Basis ${basis}, bestehen aber schon auf der Basis mit denselben reinen Umbenennungen; die Liste ist nicht gewachsen:`,
  );
  for (const { schluessel } of fromRenames) console.log(`  ${schluessel}`);
}

function reportWidened({ toolName, basis }, widened) {
  if (widened.length === 0) return;
  console.log(
    `${widened.length} Einträge in ${baselineFile(toolName)} sind neu gegenüber der Basis ${basis}, betreffen aber nur seit der Basis unveränderte Dateien und werden heute gemeldet (die Prüfung findet mehr):`,
  );
  for (const { schluessel } of widened) console.log(`  ${schluessel}`);
}

function reportGrown({ toolName, basis }, grown) {
  if (grown.length === 0) return;
  console.log(
    `${grown.length} Einträge in ${baselineFile(toolName)} stehen nicht auf der Basis ${basis}:`,
  );
  for (const { schluessel, alt } of grown) {
    console.log(`  ${schluessel}${alt === schluessel ? "" : ` (zurückgeführt: ${alt})`}`);
  }
  console.log(
    "Jeder dieser Einträge nimmt einen heutigen oder künftigen Befund aus der Prüfung. Er ist lockerer und kommt nur mit Freigabe (Approve eines Code-Owners) durch; bis dahin hält die Freigabe-Prüfung den PR rot.",
  );
  console.log(
    "Ein auf eine umbenannte Datei verschobener Eintrag zählt nicht als neu, wenn tools/umbenennung.mjs für das Paar „nur Typen ergänzt“ meldet.",
  );
}

function writeBaseline(root, toolName, { version, keys }) {
  const path = join(root, baselineFile(toolName));
  const baseline = { ...(version !== undefined && { version }), befunde: keys.toSorted() };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(baseline, null, JSON_INDENT)}\n`);
}

function installedVersion(tool, root) {
  return tool.version === undefined ? undefined : tool.version(root);
}

function checkVersion({ toolName, tool, root }, baseline) {
  const installed = installedVersion(tool, root);
  if (installed === baseline.version) return;
  throw new VersionFailure(
    `${toolName} ${installed} ist installiert, ${baselineFile(toolName)} gilt für ${toolName} ${baseline.version}. ` +
      `Nach einem Versionswechsel wird die Basislinie im selben PR neu angelegt: rm ${baselineFile(toolName)} && node tools/basis-vergleich.mjs ${toolName} --${CREATE_OPTION}`,
  );
}

function findingKeyOf(finding) {
  return finding.key;
}

function isAlways(finding) {
  return finding.always === true;
}

function frozenFindings(findings) {
  return findings.filter((finding) => !isAlways(finding));
}

const NOTHING_SHRUNK = { covered: [], keys: [] };

async function measure(context, baseline, renamed = []) {
  checkVersion(context, baseline);
  const { tool, root } = context;
  const findings = await tool.findings(root);
  const { innerhalb, darueber } = aufgeteilt(
    frozenFindings(findings),
    baseline.befunde,
    findingKeyOf,
  );
  const exact = innerhalb.map(findingKeyOf);
  const unmatched = aufgeteilt(baseline.befunde, exact, unveraendert).darueber;
  const unchangedPair = onFirstUse(() => unchangedKnownPair(context, baseline));
  const shrunk = tool.shrunk?.(darueber, unmatched, unchangedPair) ?? NOTHING_SHRUNK;
  const open = darueber.filter((finding) => !shrunk.covered.includes(finding));
  const renamedOnly = aufgeteilt(renamed, baseline.befunde, unveraendert).darueber;
  const byRename = aufgeteilt(open, renamedOnly, findingKeyOf);
  return {
    added: [...findings.filter(isAlways), ...byRename.darueber],
    renamed: byRename.innerhalb,
    known: aufgeteilt(baseline.befunde, [...exact, ...shrunk.keys], unveraendert),
    exact,
  };
}

function reportFixed({ toolName }, fixedKeys) {
  if (fixedKeys.length === 0) return;
  console.log(`${fixedKeys.length} Befunde aus ${baselineFile(toolName)} sind behoben:`);
  for (const key of fixedKeys) console.log(`  ${key}`);
  console.log(
    `Die Basislinie kann kürzer werden: node tools/basis-vergleich.mjs ${toolName} --${SHORTEN_OPTION}`,
  );
}

function reportRenamed({ toolName, basis }, renamedFindings) {
  if (renamedFindings.length === 0) return;
  console.error(
    `${renamedFindings.length} Befunde von ${toolName} stehen nicht in ${baselineFile(toolName)}, bestehen aber schon auf der Basis ${basis} mit denselben reinen Umbenennungen (Inhalt gleich):`,
  );
  for (const finding of renamedFindings) console.error(`  ${finding.location}`);
  console.error(
    `Die Basislinie zieht sie nach, ohne zu wachsen: node tools/basis-vergleich.mjs ${toolName} --${BASIS_OPTION} ${basis} --${RENAME_OPTION}`,
  );
}

function reportAdded({ toolName, tool }, addedFindings) {
  console.error(
    `${addedFindings.length} neue Befunde von ${toolName}, die nicht in ${baselineFile(toolName)} stehen:`,
  );
  for (const finding of addedFindings) console.error(`  ${finding.location}`);
  console.error("Neue Befunde werden behoben; die Basislinie nimmt keine neuen auf.");
  if (tool.zweck !== undefined) console.error(zweckBlock(tool.zweck).join(LINE_BREAK));
}

async function compare(context) {
  const baseline = readBaseline(context.root, context.toolName);
  const renamedKeys = await renamedBasisFindings(context);
  const candidates = await grownEntries(context, baseline);
  const { added, renamed, known, exact } = await measure(context, baseline, renamedKeys);
  const sameSize = renamedKeys.length > 0 && !listGrew(context, baseline) ? renamedKeys : [];
  const { fromRenames, grown: rest } = splitRenamed(candidates, sameSize);
  const { widened, grown } = splitWidening(context, rest, exact);
  reportFromRenames(context, fromRenames);
  reportWidened(context, widened);
  reportGrown(context, grown);
  reportFixed(context, known.darueber);
  console.log(
    `${context.toolName}: ${added.length} neue Befunde, ${known.innerhalb.length} bekannte.`,
  );
  if (added.length === 0 && renamed.length === 0) return;
  reportRenamed(context, renamed);
  if (added.length > 0) reportAdded(context, added);
  process.exitCode = EXIT_FAILURE;
}

async function followRenames(context) {
  const { root, toolName, tool, basis } = context;
  if (tool.renamedBasis !== true) throw new Error(usage());
  const baseline = readBaseline(root, toolName);
  const before = baselineAt(basis, toolName);
  if (before === undefined) {
    throw new Error(`${baselineFile(toolName)} gibt es auf der Basis ${basis} nicht; ohne sie wird nichts nachgezogen.`);
  }
  const limit = before.befunde.length;
  const renamedKeys = await renamedBasisFindings(context);
  const { renamed, known } = await measure(context, baseline, renamedKeys);
  const keys = [...known.innerhalb, ...renamed.map(findingKeyOf)];
  if (keys.length > limit) {
    throw new Error(
      `Nach dem Nachziehen hätte ${baselineFile(toolName)} ${keys.length} Einträge, auf der Basis ${basis} sind es ${limit}. Die Liste wächst durch Umbenennungen nicht; jeder weitere Eintrag ist lockerer und braucht Antonios Freigabe.`,
    );
  }
  writeBaseline(root, toolName, { version: baseline.version, keys });
  console.log(
    `${baselineFile(toolName)}: ${renamed.length} Einträge der umbenannten Basis nachgezogen, ${known.darueber.length} entfernt.`,
  );
}

async function shorten(context) {
  const baseline = readBaseline(context.root, context.toolName);
  const { known } = await measure(context, baseline);
  writeBaseline(context.root, context.toolName, {
    version: baseline.version,
    keys: known.innerhalb,
  });
  console.log(
    `${baselineFile(context.toolName)}: ${known.darueber.length} behobene Befunde entfernt.`,
  );
}

async function create(context) {
  const { root, toolName, tool } = context;
  if (existsSync(join(root, baselineFile(toolName)))) {
    throw new Error(
      `${baselineFile(toolName)} existiert schon. Kürzen geht mit --${SHORTEN_OPTION}, Hinzufügen gar nicht.`,
    );
  }
  const keys = frozenFindings(await tool.findings(root)).map(findingKeyOf);
  writeBaseline(root, toolName, { version: installedVersion(tool, root), keys });
  console.log(`${baselineFile(toolName)} mit ${keys.length} Befunden angelegt.`);
}

function topFolder(path) {
  return path.includes(PATH_SEPARATOR) ? path.split(PATH_SEPARATOR)[0] : ROOT_FOLDER_LABEL;
}

function perFolder(context) {
  const { befunde } = readBaseline(context.root, context.toolName);
  const counts = gezaehlt(befunde.map((key) => topFolder(context.tool.path(key))));
  for (const [folder, count] of [...counts].sort(([left], [right]) => (left < right ? -1 : 1))) {
    console.log(`${folder}: ${count}`);
  }
  console.log(`${baselineFile(context.toolName)}: ${befunde.length} Einträge`);
}

function usage() {
  return `Aufruf: node tools/basis-vergleich.mjs <${Object.keys(TOOLS).join("|")}> [--${BASIS_OPTION} <commit> | --${SHORTEN_OPTION} | --${CREATE_OPTION} | --${PER_FOLDER_OPTION}], für jscpd auch --${BASIS_OPTION} <commit> --${RENAME_OPTION}`;
}

function parseOptions() {
  const { values, positionals } = parseArgs({
    options: {
      [SHORTEN_OPTION]: { type: "boolean", default: false },
      [CREATE_OPTION]: { type: "boolean", default: false },
      [PER_FOLDER_OPTION]: { type: "boolean", default: false },
      [RENAME_OPTION]: { type: "boolean", default: false },
      [BASIS_OPTION]: { type: "string" },
    },
    allowPositionals: true,
  });
  const [toolName] = positionals;
  const modes = [SHORTEN_OPTION, CREATE_OPTION, PER_FOLDER_OPTION, RENAME_OPTION].filter(
    (mode) => values[mode],
  );
  const withBasis = values[BASIS_OPTION] !== undefined;
  const followsRenames = values[RENAME_OPTION];
  const severalModes = modes.length + (withBasis && !followsRenames ? 1 : 0) > 1;
  const missingBasis = followsRenames && !withBasis;
  if (
    !Object.hasOwn(TOOLS, toolName ?? "") ||
    positionals.length > MAX_POSITIONALS ||
    severalModes ||
    missingBasis
  ) {
    throw new Error(usage());
  }
  return { toolName, values };
}

function selectedMode(values) {
  if (values[SHORTEN_OPTION]) return shorten;
  if (values[CREATE_OPTION]) return create;
  if (values[PER_FOLDER_OPTION]) return perFolder;
  if (values[RENAME_OPTION]) return followRenames;
  return compare;
}

async function main() {
  try {
    const { toolName, values } = parseOptions();
    const basis = values[BASIS_OPTION];
    await selectedMode(values)({ toolName, tool: TOOLS[toolName], root: process.cwd(), basis });
  } catch (error) {
    console.error(`Abbruch: ${error.message}`);
    if (error instanceof VersionFailure) console.error(zweckBlock(VERSIONSWECHSEL).join(LINE_BREAK));
    process.exitCode = EXIT_FAILURE;
  }
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? ".")).href) await main();

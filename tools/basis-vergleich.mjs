import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ESLint } from "eslint";

import { pfadAusSchluessel, pfadInDerWurzel } from "./eslint-rules/bestand.js";
import {
  lesestellenSchluessel,
  quelltextLesestellen,
} from "./eslint-rules/kein-quelltext-als-text.js";
import { kommentarSchluessel, pruefbareKommentare } from "./eslint-rules/keine-kommentare.js";
import { findings as yamlShellFindings } from "./kommentare-yaml-shell.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const NODE_BIN_DIR = join(REPO_ROOT, "node_modules/.bin");
const BASELINE_DIR = "tools/basis";
const NESTED_CHECKOUTS_DIRECTORY = ".claude/worktrees";
const SEMGREP_COMMAND = "semgrep";
const SEMGREP_RULES_FILE = "tools/basis/semgrep-regeln.json";
const SEMGREP_WITHOUT_RULE_TIMEOUT = "0";
const SEMGREP_SINGLE_THREAD = "1";
const JSCPD_REPORT_FILE = "jscpd-report.json";
const KNIP_EXIT_ISSUES_FOUND = 1;
const KNIP_ROW_FIELDS_WITHOUT_ISSUES = new Set(["file", "owners"]);
const KEY_SEPARATOR = "|";
const SYMBOL_SEPARATOR = "+";
const FINGERPRINT_LENGTH = 16;
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
const COLLECTOR_PLUGIN = "basis-vergleich";
const ROOT_FOLDER_LABEL = ".";
const PATH_SEPARATOR = "/";
const TEST_FILES = ["test/**"];
const LESSONS_FILE = "tasks/lessons.md";
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

function fingerprint(text) {
  const compact = text.replace(WHITESPACE_PATTERN, "");
  return createHash("sha256").update(compact).digest("hex").slice(0, FINGERPRINT_LENGTH);
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
    key: findingKey([ruleId, path, fingerprint(snippet)]),
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

function commentKeys(context, file) {
  return pruefbareKommentare(context.sourceCode).map((comment) => ({
    key: kommentarSchluessel(file, comment),
    loc: comment.loc,
  }));
}

function commentFindings(root) {
  return eslintCollectorFindings(root, "kommentare", { keysOf: commentKeys });
}

function textReadingKeys(context, file) {
  const { sourceCode } = context;
  return quelltextLesestellen(sourceCode, file).map((call) => ({
    key: lesestellenSchluessel(sourceCode, file, call),
    loc: call.loc,
  }));
}

function textReadingFindings(root) {
  return eslintCollectorFindings(root, "quelltext-als-text", {
    keysOf: textReadingKeys,
    files: TEST_FILES,
  });
}

function lineFingerprint(line) {
  return createHash("sha256").update(line).digest("hex").slice(0, FINGERPRINT_LENGTH);
}

function lessonsFindings(root) {
  const path = join(root, LESSONS_FILE);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(LINE_BREAK);
  return lines
    .map((line, index) => ({ text: line.trim(), number: index + 1 }))
    .filter(({ text }) => text !== "")
    .map(({ text, number }) => ({
      key: findingKey([LESSONS_FILE, lineFingerprint(text)]),
      location: `${LESSONS_FILE}:${number}`,
    }));
}

function keyPart(index) {
  return (key) => key.split(KEY_SEPARATOR)[index];
}

const TOOLS = {
  jscpd: { findings: jscpdFindings, path: keyPart(0) },
  knip: { findings: knipFindings, path: keyPart(1) },
  semgrep: { findings: semgrepFindings, version: semgrepVersion, path: keyPart(1) },
  kommentare: { findings: commentFindings, path: pfadAusSchluessel },
  "quelltext-als-text": { findings: textReadingFindings, path: pfadAusSchluessel },
  "kommentare-yaml-shell": { findings: yamlShellFindings, path: pfadAusSchluessel },
  lessons: { findings: lessonsFindings, path: pfadAusSchluessel },
};

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
  throw new Error(
    `${toolName} ${installed} ist installiert, ${baselineFile(toolName)} gilt für ${toolName} ${baseline.version}.`,
  );
}

function countKeys(keys) {
  const counts = new Map();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

function splitByAllowance(items, allowedKeys, keyOf) {
  const remaining = countKeys(allowedKeys);
  const within = [];
  const beyond = [];
  for (const item of items) {
    const key = keyOf(item);
    const left = remaining.get(key) ?? 0;
    remaining.set(key, left - 1);
    if (left > 0) within.push(item);
    else beyond.push(item);
  }
  return { within, beyond };
}

function identity(key) {
  return key;
}

function findingKeyOf(finding) {
  return finding.key;
}

async function measure(context, baseline) {
  checkVersion(context, baseline);
  const findings = await context.tool.findings(context.root);
  const currentKeys = findings.map(findingKeyOf);
  return {
    added: splitByAllowance(findings, baseline.befunde, findingKeyOf).beyond,
    known: splitByAllowance(baseline.befunde, currentKeys, identity),
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

function reportAdded({ toolName }, addedFindings) {
  console.error(
    `${addedFindings.length} neue Befunde von ${toolName}, die nicht in ${baselineFile(toolName)} stehen:`,
  );
  for (const finding of addedFindings) console.error(`  ${finding.location}`);
  console.error("Neue Befunde werden behoben; die Basislinie nimmt keine neuen auf.");
}

async function compare(context) {
  const { added, known } = await measure(context, readBaseline(context.root, context.toolName));
  reportFixed(context, known.beyond);
  console.log(
    `${context.toolName}: ${added.length} neue Befunde, ${known.within.length} bekannte.`,
  );
  if (added.length === 0) return;
  reportAdded(context, added);
  process.exitCode = EXIT_FAILURE;
}

async function shorten(context) {
  const baseline = readBaseline(context.root, context.toolName);
  const { known } = await measure(context, baseline);
  writeBaseline(context.root, context.toolName, { version: baseline.version, keys: known.within });
  console.log(
    `${baselineFile(context.toolName)}: ${known.beyond.length} behobene Befunde entfernt.`,
  );
}

async function create(context) {
  const { root, toolName, tool } = context;
  if (existsSync(join(root, baselineFile(toolName)))) {
    throw new Error(
      `${baselineFile(toolName)} existiert schon. Kürzen geht mit --${SHORTEN_OPTION}, Hinzufügen gar nicht.`,
    );
  }
  const keys = (await tool.findings(root)).map(findingKeyOf);
  writeBaseline(root, toolName, { version: installedVersion(tool, root), keys });
  console.log(`${baselineFile(toolName)} mit ${keys.length} Befunden angelegt.`);
}

function topFolder(path) {
  return path.includes(PATH_SEPARATOR) ? path.split(PATH_SEPARATOR)[0] : ROOT_FOLDER_LABEL;
}

function perFolder(context) {
  const { befunde } = readBaseline(context.root, context.toolName);
  const counts = countKeys(befunde.map((key) => topFolder(context.tool.path(key))));
  for (const [folder, count] of [...counts].sort(([left], [right]) => (left < right ? -1 : 1))) {
    console.log(`${folder}: ${count}`);
  }
  console.log(`${baselineFile(context.toolName)}: ${befunde.length} Einträge`);
}

function usage() {
  return `Aufruf: node tools/basis-vergleich.mjs <${Object.keys(TOOLS).join("|")}> [--${SHORTEN_OPTION} | --${CREATE_OPTION} | --${PER_FOLDER_OPTION}]`;
}

function parseOptions() {
  const { values, positionals } = parseArgs({
    options: {
      [SHORTEN_OPTION]: { type: "boolean", default: false },
      [CREATE_OPTION]: { type: "boolean", default: false },
      [PER_FOLDER_OPTION]: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  const [toolName] = positionals;
  const modes = [SHORTEN_OPTION, CREATE_OPTION, PER_FOLDER_OPTION].filter((mode) => values[mode]);
  const severalModes = modes.length > 1;
  if (!Object.hasOwn(TOOLS, toolName ?? "") || positionals.length > MAX_POSITIONALS || severalModes) {
    throw new Error(usage());
  }
  return { toolName, values };
}

function selectedMode(values) {
  if (values[SHORTEN_OPTION]) return shorten;
  if (values[CREATE_OPTION]) return create;
  if (values[PER_FOLDER_OPTION]) return perFolder;
  return compare;
}

try {
  const { toolName, values } = parseOptions();
  await selectedMode(values)({ toolName, tool: TOOLS[toolName], root: process.cwd() });
} catch (error) {
  console.error(`Abbruch: ${error.message}`);
  process.exitCode = EXIT_FAILURE;
}

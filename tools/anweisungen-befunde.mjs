import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const KEY_SEPARATOR = "|";
const PATH_SEPARATOR = "/";
const LINE_BREAK = "\n";
const FINGERPRINT_LENGTH = 16;
const MAX_GIT_OUTPUT_BYTES = 268_435_456;
const INSTRUCTION_FILE_NAMES = new Set(["CLAUDE.md", "AGENTS.md", "CLAUDE.local.md"]);
const RULES_DIRECTORY = ".claude/rules/";
const NESTED_RULES_DIRECTORY = `${PATH_SEPARATOR}${RULES_DIRECTORY}`;
const MARKDOWN_SUFFIX = ".md";
const IGNORED_SEGMENT = "node_modules";
const SOURCE_DIRECTORY = "src";
const FOLDER_INSTRUCTIONS = "CLAUDE.md";
const MIN_PARTS_IN_SOURCE_FOLDER = 3;
const WITHOUT_OWN_RULES = "ohne-eigene-regeln";
const ROOT_ENTRY = "wurzel-eintrag";
const ROOT_MARKDOWN_ALLOWED = new Set(["README.md", "CLAUDE.md"]);
const FORBIDDEN_ROOT_ENTRIES = new Set(["tasks"]);
const HEADING = /^#/;
const CODE_FENCE = /^```/;
const CODE_SPAN = /`[^`]*`/g;
const IMPORT = /(?:^|\s)@[^\s@]/;

function lineFingerprint(line) {
  return createHash("sha256").update(line).digest("hex").slice(0, FINGERPRINT_LENGTH);
}

function key(parts) {
  return parts.join(KEY_SEPARATOR);
}

function always(findingKey, location) {
  return { key: findingKey, location, always: true };
}

function trackedFiles(root) {
  const args = ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT_BYTES });
  if (result.status !== 0) throw new Error(`git ls-files ist gescheitert: ${result.stderr.trim()}`);
  const paths = result.stdout.split("\0").filter((path) => path !== "" && !path.endsWith(PATH_SEPARATOR));
  return [...new Set(paths)].filter((path) => existsSync(join(root, path))).sort();
}

function isInstructionFile(path) {
  if (path.split(PATH_SEPARATOR).includes(IGNORED_SEGMENT)) return false;
  if (INSTRUCTION_FILE_NAMES.has(basename(path))) return true;
  const inRules = path.startsWith(RULES_DIRECTORY) || path.includes(NESTED_RULES_DIRECTORY);
  return inRules && path.endsWith(MARKDOWN_SUFFIX);
}

function numberedLines(root, path) {
  return readFileSync(join(root, path), "utf8")
    .split(LINE_BREAK)
    .map((line, index) => ({ path, text: line.trim(), number: index + 1 }))
    .filter(({ text }) => text !== "");
}

function lineFinding({ path, text, number }) {
  return { key: key([path, lineFingerprint(text)]), location: `${path}:${number}` };
}

function importFindings(lines) {
  return lines
    .filter(({ text }) => IMPORT.test(text.replace(CODE_SPAN, "")))
    .map(({ path, text, number }) =>
      always(key([path, "import", lineFingerprint(text)]), `${path}:${number} @-Import`),
    );
}

function duplicateFindings(lines) {
  const firstSeen = new Map();
  const findings = [];
  for (const line of lines.filter(({ text }) => !HEADING.test(text) && !CODE_FENCE.test(text))) {
    const first = firstSeen.get(line.text);
    if (first === undefined) firstSeen.set(line.text, line);
    else if (first.path !== line.path) {
      const location = `${line.path}:${line.number} doppelt, steht schon in ${first.path}:${first.number}`;
      findings.push(always(key([line.path, "doppelt", lineFingerprint(line.text)]), location));
    }
  }
  return findings;
}

function sourceFolders(files) {
  const folders = files
    .map((path) => path.split(PATH_SEPARATOR))
    .filter((parts) => parts[0] === SOURCE_DIRECTORY && parts.length >= MIN_PARTS_IN_SOURCE_FOLDER)
    .map((parts) => `${SOURCE_DIRECTORY}${PATH_SEPARATOR}${parts[1]}`);
  return [...new Set(folders)].sort();
}

function folderFindings(files) {
  const present = new Set(files);
  return sourceFolders(files)
    .filter((folder) => !present.has(`${folder}${PATH_SEPARATOR}${FOLDER_INSTRUCTIONS}`))
    .map((folder) => ({
      key: key([folder, WITHOUT_OWN_RULES]),
      location: `${folder} hat keine ${FOLDER_INSTRUCTIONS}`,
    }));
}

export function instructionFindings(root) {
  const files = trackedFiles(root);
  const lines = files.filter(isInstructionFile).flatMap((path) => numberedLines(root, path));
  return [
    ...lines.map(lineFinding),
    ...duplicateFindings(lines),
    ...importFindings(lines),
    ...folderFindings(files),
  ];
}

function rootEntries(root) {
  return [...new Set(trackedFiles(root).map((path) => path.split(PATH_SEPARATOR)[0]))].sort();
}

function forbiddenRootEntry(entry) {
  if (FORBIDDEN_ROOT_ENTRIES.has(entry)) return true;
  return entry.toLowerCase().endsWith(MARKDOWN_SUFFIX) && !ROOT_MARKDOWN_ALLOWED.has(entry);
}

function rootFinding(entry) {
  if (!forbiddenRootEntry(entry)) return { key: key([entry, ROOT_ENTRY]), location: entry };
  const allowed = [...ROOT_MARKDOWN_ALLOWED].join(" und ");
  return always(key([entry, "verboten"]), `${entry} gehört nicht in den Wurzelordner (nur ${allowed} als Markdown, kein tasks/)`);
}

export function rootFindings(root) {
  return rootEntries(root).map(rootFinding);
}

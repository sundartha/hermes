import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { Linter } from "eslint";

const TEST_DIR = "test/";
const UNPROTECTED_TEST_PATHS = [":(exclude)test/testbaenke-run.mjs", ":(exclude)test/werkzeuge/"];
const GATE_TESTS_FILE = "tools/gate-tests.json";
const TEST_FUNCTIONS = new Set(["test", "it"]);
const SUBTEST_METHOD = "test";
const SUBTEST_MIN_ARGUMENTS = 2;
const FUNCTION_NODE_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);
const JAVASCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const COMMONJS_EXTENSION = ".cjs";
const STATUS_ADDED = "A";
const STATUS_DELETED = "D";
const BINARY_DIFF_PATTERN = /^Binary files /m;
const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+/;
const DEFAULT_HUNK_LENGTH = 1;
const NAME_STATUS_FIELDS = 2;
const MAX_GIT_OUTPUT_BYTES = 67_108_864;

export function git(args) {
  const result = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} ist gescheitert: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

export function changedExistingTestFiles(basis) {
  const fields = git([
    "diff",
    "--no-renames",
    "--name-status",
    "-z",
    basis,
    "HEAD",
    "--",
    TEST_DIR,
    ...UNPROTECTED_TEST_PATHS,
  ]).split("\0");
  const changes = [];
  for (let i = 0; i + 1 < fields.length; i += NAME_STATUS_FIELDS) {
    changes.push({ status: fields[i], file: fields[i + 1] });
  }
  return changes.filter(({ status }) => status !== STATUS_ADDED);
}

function removedLines(basis, file) {
  const diff = git([
    "diff",
    "--no-renames",
    "--no-color",
    "--no-ext-diff",
    "-U0",
    basis,
    "HEAD",
    "--",
    file,
  ]);
  const lines = diff.split("\n").flatMap((line) => {
    const match = HUNK_HEADER_PATTERN.exec(line);
    if (match === null) return [];
    const start = Number(match[1]);
    const length = match[2] === undefined ? DEFAULT_HUNK_LENGTH : Number(match[2]);
    return [...Array.from({ length }).keys()].map((offset) => start + offset);
  });
  return { lines, binary: BINARY_DIFF_PATTERN.test(diff) };
}

function callExpressions(sourceCode) {
  const found = [];
  const pending = [sourceCode.ast];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node.type === "CallExpression") found.push(node);
    for (const key of sourceCode.visitorKeys[node.type] ?? []) {
      pending.push(...[node[key]].flat().filter(Boolean));
    }
  }
  return found;
}

function isTestCall({ callee, arguments: args }) {
  if (callee.type === "Identifier") return TEST_FUNCTIONS.has(callee.name);
  if (callee.type !== "MemberExpression") return false;
  if (TEST_FUNCTIONS.has(callee.object.name)) return true;
  const isSubtest = callee.property.name === SUBTEST_METHOD && args.length >= SUBTEST_MIN_ARGUMENTS;
  return isSubtest && FUNCTION_NODE_TYPES.has(args.at(-1).type);
}

export function staticTestName(argument) {
  if (argument?.type === "Literal" && typeof argument.value === "string") return argument.value;
  if (argument?.type === "TemplateLiteral" && argument.expressions.length === 0) {
    const [quasi] = argument.quasis;
    return quasi.value.cooked;
  }
  return undefined;
}

export function sourceTypeOf(file) {
  return extname(file) === COMMONJS_EXTENSION ? "commonjs" : "module";
}

export function isJavaScript(file) {
  return JAVASCRIPT_EXTENSIONS.has(extname(file));
}

export function testSource(file, source) {
  const linter = new Linter();
  const messages = linter.verify(source, {
    languageOptions: { ecmaVersion: "latest", sourceType: sourceTypeOf(file) },
  });
  if (messages.some(({ fatal }) => fatal)) return undefined;
  const sourceCode = linter.getSourceCode();
  return { sourceCode, calls: callExpressions(sourceCode).filter(isTestCall) };
}

function testCases(file, source) {
  const cases = testSource(file, source)?.calls ?? [];
  const named = cases.map((node) => ({ name: staticTestName(node.arguments[0]), loc: node.loc }));
  return named.filter(({ name }) => name !== undefined);
}

function innermostTestName(cases, line) {
  const enclosing = cases.filter(({ loc }) => loc.start.line <= line && line <= loc.end.line);
  const span = ({ loc }) => loc.end.line - loc.start.line;
  return enclosing.toSorted((left, right) => span(left) - span(right))[0]?.name;
}

function groupLines(file, lines, nameOfLine) {
  const units = new Map();
  for (const line of lines) {
    const name = nameOfLine(line);
    if (!units.has(name)) units.set(name, { file, name, lines: [] });
    units.get(name).lines.push(line);
  }
  return [...units.values()];
}

export function changedUnits(basis, { status, file, details = [] }) {
  if (status === STATUS_DELETED) return [{ file, deleted: true, lines: [], details }];
  const { lines, binary } = removedLines(basis, file);
  if (binary) return [{ file, name: undefined, lines: [] }];
  if (!JAVASCRIPT_EXTENSIONS.has(extname(file))) return groupLines(file, lines, () => undefined);
  const cases = testCases(file, git(["show", `${basis}:${file}`]));
  return groupLines(file, lines, (line) => innermostTestName(cases, line));
}

export function gatesByTestFile(text = readFileSync(GATE_TESTS_FILE, "utf8")) {
  const gates = JSON.parse(text);
  const byFile = new Map();
  for (const [gate, { tests }] of Object.entries(gates)) {
    for (const file of tests) byFile.set(file, [...(byFile.get(file) ?? []), gate]);
  }
  return byFile;
}

export function gatesAt(basis) {
  return gatesByTestFile(git(["show", `${basis}:${GATE_TESTS_FILE}`]));
}

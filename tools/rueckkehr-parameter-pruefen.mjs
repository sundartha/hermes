import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { VisitorKeys, parse } from "espree";

const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_USAGE = 2;
const SHELL_FILE = "apps/web/src/components/app/BillingIsland.astro";
const PORTAL_PATHS_FILE = "src/portal-paths.js";
const WEB_SOURCE_DIR = "apps/web/src";
const RETURN_CONSTANT = /const (RETURN_\w+) = "([^"]+)";/g;
const RETURN_PARAM_PREFIX = /^RETURN_PARAM_/;
const RETURN_FUNCTION_HEAD = /^[ \t]*function returnMessageText\(([^)]*)\)\s*\{/gm;
const CODE_TOKEN = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\$]|\\.|\$(?!\{))*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[{}/`"']/g;
const UNCLEAR_TOKENS = new Set(["/", "`", '"', "'"]);
const SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
const MARKUP_PART = /<[!]--[\s\S]*?(?:-->|$)|<script\b[^>]*>([\s\S]*?)<\/script>/dg;
const PARSER_OPTIONS = { ecmaVersion: "latest", sourceType: "module", comment: true, range: true };
const RETURN_FUNCTION = "returnMessageText";
const PARAMS_NAME = "params";
const QUERY_SOURCES = new Set(["location.search", "window.location.search"]);
const SCOPE_NODES = new Set(["BlockStatement", "Program"]);
const FUNCTION_NODES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassBody"]);
const GUARDED_NAMES = new Set([PARAMS_NAME, "location", "window", "URLSearchParams"]);
const UNREADABLE_SCRIPT = "ein script-Block der Shell laesst sich nicht als JavaScript lesen";
const UNCLEAR_CALL = "returnMessageText wird anders als mit params.get(...) als Argumenten aufgerufen oder weitergereicht";
const NOT_FROM_LOCATION = "params ist beim Aufruf nicht aus new URLSearchParams(window.location.search) gesetzt";
const LOCALE_FORMATTING = /toLocale|Intl|de-DE|fr-FR/g;
const LOCALE_HINT = "in einem script-Block; Datum und Zahlen formatiert apps/web nur in apps/web/src/lib/subscribe.js";
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "Aufruf: node tools/rueckkehr-parameter-pruefen.mjs [--wurzel <ordner>]";

function failUsage(message) {
  process.stderr.write(`${message}\n${USAGE}\n`);
  process.exit(EXIT_USAGE);
}

function rootFromArguments() {
  try {
    const { values } = parseArgs({ options: { wurzel: { type: "string" } }, strict: true, allowPositionals: false });
    return resolve(values.wurzel ?? DEFAULT_ROOT);
  } catch (error) {
    return failUsage(error.message);
  }
}

function requireFile(root, file) {
  const full = join(root, file);
  if (!existsSync(full)) failUsage(`Datei fehlt: ${full}`);
  return full;
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function returnParts(target) {
  const query = target.split("?")[1] ?? "";
  const [param, value] = query.split("=");
  return { param, value };
}

function blankOut(text) {
  return text.replace(/[^\n]/g, " ");
}

function parseScript(text) {
  try {
    return { program: parse(text, PARSER_OPTIONS) };
  } catch (error) {
    return { error };
  }
}

function withoutComments(text, comments) {
  return comments.reduce((rest, { range: [from, to] }) => rest.slice(0, from) + blankOut(rest.slice(from, to)) + rest.slice(to), text);
}

function readScripts(source) {
  let code = blankOut(source);
  const programs = [];
  const unreadable = [];
  for (const part of source.matchAll(MARKUP_PART)) {
    if (part[1] === undefined) continue;
    const [start, end] = part.indices[1];
    const { program, error } = parseScript(part[1]);
    if (error) unreadable.push({ line: lineAt(source, start) + error.lineNumber - 1, text: UNREADABLE_SCRIPT });
    else programs.push(program);
    const visible = program ? withoutComments(part[1], program.comments) : part[1];
    code = code.slice(0, start) + visible + code.slice(end);
  }
  return { code, programs, unreadable };
}

function readShell(file) {
  const { code, programs, unreadable } = readScripts(readFileSync(file, "utf8"));
  const constants = new Map();
  for (const match of code.matchAll(RETURN_CONSTANT)) constants.set(match[2], match[1]);
  const heads = [...code.matchAll(RETURN_FUNCTION_HEAD)];
  const [head] = heads;
  const body = heads.length === 1 ? functionBody(code, head.index + head[0].length) : undefined;
  const branch = body === undefined ? undefined : { args: head[1].split(",").map((arg) => arg.trim()), body };
  const line = head ? lineAt(code, head.index) : 1;
  return { constants, found: heads.length > 0, branch, ...queryUse(programs), unreadable, line };
}

function functionBody(source, bodyStart) {
  let depth = 1;
  for (const token of source.slice(bodyStart).matchAll(CODE_TOKEN)) {
    if (UNCLEAR_TOKENS.has(token[0])) return undefined;
    if (token[0] === "{") depth += 1;
    if (token[0] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart, bodyStart + token.index);
  }
  return undefined;
}

function walk(node, path, visit) {
  visit(node, path);
  for (const key of VisitorKeys[node.type]) {
    for (const child of [node[key]].flat()) if (child) walk(child, [...path, node], visit);
  }
}

function memberPath(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type !== "MemberExpression" || node.computed) return undefined;
  const object = memberPath(node.object);
  return object === undefined ? undefined : `${object}.${node.property.name}`;
}

function isLocationQuery(init) {
  if (init?.type !== "NewExpression" || memberPath(init.callee) !== "URLSearchParams") return false;
  return init.arguments.length === 1 && QUERY_SOURCES.has(memberPath(init.arguments[0]));
}

function isLocationDeclarator(declarator) {
  return declarator.id.name === PARAMS_NAME && isLocationQuery(declarator.init);
}

function paramsDeclaration(scope) {
  if (!SCOPE_NODES.has(scope.type)) return undefined;
  return scope.body.find((statement) => statement.type === "VariableDeclaration" && statement.declarations.some(isLocationDeclarator));
}

function isCalledOnly(boundary, { names, visiting }, runs) {
  if (boundary.type !== "FunctionDeclaration" || boundary.id === null || boundary.generator || boundary.async || visiting.has(boundary)) return false;
  const inside = new Set([...visiting, boundary]);
  const called = (use) => {
    const parent = use.path.at(-1);
    return parent.type === "CallExpression" && parent.callee === use.node && runs({ node: parent, path: use.path.slice(0, -1) }, inside);
  };
  const [, declaredIn] = names.find((use) => use.node === boundary.id).path.toReversed();
  const uses = names.filter((use) => use.node.name === boundary.id.name && use.node !== boundary.id && use.path.includes(declaredIn));
  return uses.length > 0 && uses.every(called);
}

function isInvoked(path, names, visiting) {
  const boundary = path.findLast((step) => FUNCTION_NODES.has(step.type));
  return boundary === undefined || isCalledOnly(boundary, { names, visiting }, (call, inside) => isInvoked(call.path, names, inside));
}

function isSetBeforeCall({ node, path }, names) {
  const scope = path.findLast((step) => paramsDeclaration(step) !== undefined);
  if (scope === undefined) return false;
  const outside = path.slice(0, path.indexOf(scope));
  const sameBody = !path.slice(outside.length).some((step) => FUNCTION_NODES.has(step.type));
  return sameBody && node.range[0] >= paramsDeclaration(scope).range[1] && isInvoked(outside, names, new Set());
}

function isParamsGet(node) {
  return node.type === "CallExpression" && memberPath(node.callee) === `${PARAMS_NAME}.get`;
}

function isReturnCall(node) {
  if (node.type !== "CallExpression" || memberPath(node.callee) !== RETURN_FUNCTION) return false;
  return node.arguments.length > 0 && node.arguments.every(isParamsGet);
}

function isStrayParams(parent, grandparent) {
  const declaration = parent.type === "VariableDeclarator" && isLocationDeclarator(parent);
  const read = parent === grandparent.callee && isParamsGet(grandparent);
  return !declaration && !read;
}

function isStrayGlobal(node, parent) {
  const member = parent.type === "MemberExpression" && parent.object === node;
  const constructed = parent.type === "NewExpression" && parent.callee === node;
  return !member && !constructed;
}

function isStrayName(node, path) {
  if (node.type !== "Identifier" || !GUARDED_NAMES.has(node.name)) return false;
  const [parent, grandparent] = path.toReversed();
  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return false;
  return node.name === PARAMS_NAME ? isStrayParams(parent, grandparent) : isStrayGlobal(node, parent);
}

function isStrayReturnFunction(node, path) {
  if (node.type !== "Identifier" || node.name !== RETURN_FUNCTION) return false;
  const parent = path.at(-1);
  const declared = parent.type === "FunctionDeclaration" && parent.id === node;
  const called = parent.type === "CallExpression" && parent.callee === node && isReturnCall(parent);
  return !declared && !called;
}

function queryUse(programs) {
  const calls = [];
  const names = [];
  let stray = 0;
  let strayCalls = 0;
  for (const program of programs) {
    walk(program, [], (node, path) => {
      if (isReturnCall(node)) calls.push({ node, path });
      if (node.type === "Identifier") names.push({ node, path });
      if (isStrayName(node, path)) stray += 1;
      if (isStrayReturnFunction(node, path)) strayCalls += 1;
    });
  }
  const reads = calls.map(({ node }) => node.arguments.map((read) => read.arguments[0]?.name));
  const [first = [], ...others] = reads;
  const agreed = (name, position) => others.every((names) => names[position] === name);
  return {
    passed: new Map(first.flatMap((name, position) => (agreed(name, position) ? [[name, position]] : []))),
    fromLocation: stray === 0 && calls.every((call) => isSetBeforeCall(call, names)),
    callsClear: strayCalls === 0,
  };
}

const IDENTIFIER_CHAR_AT_END = /(?:[\p{ID_Continue}$\u200c\u200d]|\\u\{[0-9a-fA-F]+\})$/u;
const IDENTIFIER_CHAR_AT_START = /^(?:[\p{ID_Continue}$\u200c\u200d]|\\)/u;

function containsWholeName(text, part) {
  let index = text.indexOf(part);
  while (index !== -1) {
    const before = text.slice(0, index);
    const after = text.slice(index + part.length);
    if (!IDENTIFIER_CHAR_AT_END.test(before) && !IDENTIFIER_CHAR_AT_START.test(after)) return true;
    index = text.indexOf(part, index + 1);
  }
  return false;
}

function branchProblem(shell, paramConst, valueConst) {
  if (!shell.found) return "die Shell hat keine Funktion returnMessageText()";
  if (!shell.branch) return "der Rumpf von returnMessageText() laesst sich nicht eindeutig lesen";
  if (!shell.passed.has(paramConst)) return `die Shell gibt ${paramConst} nicht an returnMessageText weiter`;
  if (!shell.callsClear) return UNCLEAR_CALL;
  if (!shell.fromLocation) return NOT_FROM_LOCATION;
  const arg = shell.branch.args[shell.passed.get(paramConst)];
  if (containsWholeName(shell.branch.body, `${arg} === ${valueConst}`)) return undefined;
  return `kein Zweig "${arg} === ${valueConst}" - der Fall bleibt fuer den Kunden stumm`;
}

function targetProblems(shell, param, value) {
  const paramConst = shell.constants.get(param);
  if (paramConst === undefined) return [`die Shell kennt den Parameter "${param}" nicht`];
  const problems = [];
  if (!RETURN_PARAM_PREFIX.test(paramConst)) problems.push(`"${param}" ist keine Parameter-Konstante`);
  const valueConst = shell.constants.get(value);
  if (valueConst === undefined) return [...problems, `die Shell kennt den Wert "${value}" nicht`];
  const missingBranch = branchProblem(shell, paramConst, valueConst);
  return missingBranch ? [...problems, missingBranch] : problems;
}

function shellFindings(root, checkoutReturn) {
  const file = join(root, SHELL_FILE);
  const shell = readShell(file);
  const unreadable = shell.unreadable.map(({ line, text }) => ({ file: SHELL_FILE, line, text }));
  const targets = Object.entries(checkoutReturn).flatMap(([name, target]) => {
    const { param, value } = returnParts(target);
    return targetProblems(shell, param, value).map((problem) => ({
      file: SHELL_FILE,
      line: shell.line,
      text: `${name}: ${problem}`,
    }));
  });
  return [...unreadable, ...targets];
}

function astroFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && extname(entry.name) === ".astro")
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

function scriptLocaleFindings(root, file) {
  const source = readFileSync(file, "utf8");
  const findings = [];
  for (const block of source.matchAll(SCRIPT_BLOCK)) {
    const contentStart = block.index + block[0].indexOf(">") + 1;
    for (const hit of block[1].matchAll(LOCALE_FORMATTING)) {
      const line = lineAt(source, contentStart + hit.index);
      findings.push({ file: relative(root, file), line, text: `${hit[0]} ${LOCALE_HINT}` });
    }
  }
  return findings;
}

async function loadCheckoutReturn(file) {
  try {
    const { CHECKOUT_RETURN } = await import(pathToFileURL(file).href);
    return CHECKOUT_RETURN ?? failUsage(`${file} exportiert kein CHECKOUT_RETURN`);
  } catch (error) {
    return failUsage(`${file} laesst sich nicht laden: ${error.message}`);
  }
}

const root = rootFromArguments();
const portalPaths = requireFile(root, PORTAL_PATHS_FILE);
requireFile(root, SHELL_FILE);
const webSource = requireFile(root, WEB_SOURCE_DIR);
const checkoutReturn = await loadCheckoutReturn(portalPaths);
const findings = [
  ...shellFindings(root, checkoutReturn),
  ...astroFiles(webSource).flatMap((file) => scriptLocaleFindings(root, file)),
];
for (const { file, line, text } of findings) process.stdout.write(`${file}:${line} ${text}\n`);
process.exitCode = findings.length === 0 ? EXIT_OK : EXIT_FINDING;

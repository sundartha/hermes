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
const RETURN_NAME = /^RETURN_/;
const RETURN_PARAM_PREFIX = /^RETURN_PARAM_/;
const SCRIPT_PART = String.raw`<script\b[^>]*>([\s\S]*?)<\/script\s*>`;
const SCRIPT_BLOCK = new RegExp(SCRIPT_PART, "gi");
const MARKUP_PART = new RegExp(String.raw`<[!]--[\s\S]*?(?:-->|$)|${SCRIPT_PART}`, "dgi");
const EXECUTABLE_MARKUP = /<script|\son[a-z]+\s*=|javascript:|set:html|srcdoc/gi;
const PARSER_OPTIONS = { ecmaVersion: "latest", sourceType: "module", range: true };
const RETURN_FUNCTION = "returnMessageText";
const PARAMS_NAME = "params";
const QUERY_SOURCES = new Set(["location.search", "window.location.search"]);
const SCOPE_NODES = new Set(["BlockStatement", "Program"]);
const FUNCTION_NODES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassBody"]);
const QUERY_CLASS = "URLSearchParams";
const LOCATION = "location";
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self", "top", "parent", "frames", "opener"]);
const GUARDED_KEYS = new Set([QUERY_CLASS, LOCATION]);
const META_WORDS = new Set([
  "Object",
  "Reflect",
  "Proxy",
  "eval",
  "Function",
  "URL",
  "prototype",
  "constructor",
  "searchParams",
  "defaultView",
  "createElement",
  "createAttribute",
  "setAttribute",
  "setAttributeNS",
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "srcdoc",
  "write",
  "writeln",
  "createContextualFragment",
  "setHTMLUnsafe",
  "parseHTMLUnsafe",
]);
const META_PREFIX = "__";
const FORBIDDEN_TEXT = [...GUARDED_KEYS, ...META_WORDS, META_PREFIX, "javascript:"];
const TIMERS = new Set(["setTimeout", "setInterval"]);
const FUNCTION_VALUES = new Set(["FunctionExpression", "ArrowFunctionExpression"]);
const GUARDED_NAMES = new Set([PARAMS_NAME, ...GUARDED_KEYS, ...GLOBAL_OBJECTS]);
const WRITE_LEFT = new Set(["AssignmentExpression", "AssignmentPattern", "ForInStatement", "ForOfStatement"]);
const WRITE_ALWAYS = new Set(["UpdateExpression", "UnaryExpression", "ArrayPattern", "RestElement"]);
const UNREADABLE_SCRIPT = "ein script-Block der Shell laesst sich nicht als JavaScript lesen";
const EXECUTABLE_HINT = "ist ausfuehrbares Markup ausserhalb eines lesbaren script-Blocks";
const UNCLEAR_CALL = "returnMessageText wird anders als mit params.get(...) als Argumenten aufgerufen oder weitergereicht";
const HIDDEN_FUNCTION = "returnMessageText ist am Ort eines Aufrufs nicht sichtbar";
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

function parseScript(text) {
  try {
    return { program: parse(text, PARSER_OPTIONS) };
  } catch (error) {
    return { error };
  }
}

function executableMarkup(source, from, to) {
  return [...source.slice(from, to).matchAll(EXECUTABLE_MARKUP)].map((hit) => ({
    line: lineAt(source, from + hit.index),
    text: `${hit[0].trim()} ${EXECUTABLE_HINT}`,
  }));
}

function readScripts(source) {
  const programs = [];
  const findings = [];
  let markupStart = 0;
  for (const part of source.matchAll(MARKUP_PART)) {
    findings.push(...executableMarkup(source, markupStart, part.index));
    markupStart = part.index + part[0].length;
    if (part[1] === undefined) continue;
    const [start] = part.indices[1];
    const { program, error } = parseScript(part[1]);
    if (error) findings.push({ line: lineAt(source, start) + error.lineNumber - 1, text: UNREADABLE_SCRIPT });
    else programs.push({ program, start });
  }
  findings.push(...executableMarkup(source, markupStart, source.length));
  return { programs, findings };
}

function returnConstants(programs) {
  const constants = new Map();
  const declared = new Set();
  const declarations = new Map();
  for (const { program } of programs) {
    for (const statement of program.body) {
      if (statement.type !== "VariableDeclaration" || statement.kind !== "const") continue;
      for (const { id, init } of statement.declarations) {
        if (!RETURN_NAME.test(id.name) || init.type !== "Literal") continue;
        constants.set(init.value, id.name);
        declared.add(id);
        declarations.set(id.name, { program, end: statement.range[1] });
      }
    }
  }
  return { constants, declared, declarations };
}

function identifiers(root) {
  const found = [];
  walk(root, [], (node, path) => {
    if (node.type === "Identifier") found.push({ node, parent: path.at(-1) });
  });
  return found;
}

function functionBranch(fn) {
  return {
    args: fn.params.map((param) => param.name),
    body: fn.body.body,
    argUses: identifiers(fn).filter(({ node }) => !fn.params.includes(node)),
  };
}

function returnFunctions(programs) {
  const found = [];
  for (const entry of programs) {
    walk(entry.program, [], (node, path) => {
      if (node.type === "FunctionDeclaration" && node.id?.name === RETURN_FUNCTION) found.push({ ...entry, node, scope: path.at(-1) });
    });
  }
  return found;
}

function readShell(file) {
  const source = readFileSync(file, "utf8");
  const { programs, findings } = readScripts(source);
  const functions = returnFunctions(programs);
  const [first] = functions;
  const single = functions.length === 1;
  const home = single ? functions : programs;
  const { constants, declared, declarations } = returnConstants(home);
  const branch = single ? functionBranch(first.node) : undefined;
  const blockUses = home.flatMap(({ program }) => identifiers(program)).filter(({ node }) => !declared.has(node));
  const line = first ? lineAt(source, first.start + first.node.range[0]) : 1;
  const use = queryUse(programs.map(({ program }) => program));
  return { constants, declarations, blockUses, functionScope: first?.scope, found: functions.length > 0, branch, ...use, markupFindings: findings, line };
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

function isMemberObject(node, parent) {
  return parent.type === "MemberExpression" && parent.object === node && !parent.computed;
}

function isWritten(top, path) {
  const [parent, grandparent] = path.toReversed();
  if (WRITE_LEFT.has(parent.type)) return parent.left === top;
  if (parent.type === "Property") return grandparent.type === "ObjectPattern";
  return WRITE_ALWAYS.has(parent.type);
}

function isLocationRead(node, path) {
  if (!isMemberObject(node, path.at(-1))) return false;
  let top = node;
  let rest = path;
  while (rest.at(-1).type === "MemberExpression" && rest.at(-1).object === top) {
    top = rest.at(-1);
    rest = rest.slice(0, -1);
  }
  return !isWritten(top, rest);
}

function isStrayGlobal(node, path) {
  const parent = path.at(-1);
  if (node.name === QUERY_CLASS) return !isParamsClass(path.toReversed());
  if (node.name === LOCATION) return !isLocationRead(node, path);
  return !isMemberObject(node, parent);
}

function isStrayProperty(node, member, path) {
  if (node.name === QUERY_CLASS) return true;
  return node.name === LOCATION && !isLocationRead(member, path);
}

function isComputedKey(node) {
  return node.computed === true && (node.property ?? node.key).type !== "Literal";
}

function isMetaTool(node) {
  const metaName = node.type === "Identifier" && (META_WORDS.has(node.name) || node.name.startsWith(META_PREFIX));
  return metaName || node.type === "ImportExpression";
}

function textOf(node) {
  if (node.type === "Literal") return String(node.value);
  return node.type === "TemplateElement" ? (node.value.cooked ?? "") : "";
}

function isForbiddenText(node) {
  const text = textOf(node);
  return FORBIDDEN_TEXT.some((word) => text.includes(word));
}

function declaresFunction(node, parent) {
  return parent.type === "FunctionDeclaration" && parent.id === node;
}

function isFixedFunction(name, path, names) {
  const uses = names.filter(({ node }) => node.name === name);
  const declarations = uses.filter((use) => declaresFunction(use.node, use.path.at(-1)));
  if (declarations.length !== 1) return false;
  const [, scope] = declarations[0].path.toReversed();
  const plain = (use) => declarations.includes(use) || use.path.at(-1).type === "CallExpression";
  return path.includes(scope) && uses.every(plain);
}

function isTimerWithFunction({ node, path }, names) {
  const call = path.at(-1);
  if (call.type !== "CallExpression" || call.callee !== node) return false;
  const [first] = call.arguments;
  if (first?.type === "Identifier") return isFixedFunction(first.name, path, names);
  return FUNCTION_VALUES.has(first?.type);
}

function strayTimers(names) {
  return names.filter((use) => TIMERS.has(use.node.name) && !isTimerWithFunction(use, names)).length;
}

function isParamsClass([parent, declarator]) {
  return declarator.type === "VariableDeclarator" && declarator.init === parent && isLocationDeclarator(declarator);
}

function isStrayName(node, path) {
  if (node.type !== "Identifier" || !GUARDED_NAMES.has(node.name)) return false;
  const [parent, grandparent] = path.toReversed();
  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return isStrayProperty(node, parent, path.slice(0, -1));
  return node.name === PARAMS_NAME ? isStrayParams(parent, grandparent) : isStrayGlobal(node, path);
}

function isStrayReturnFunction(node, path) {
  if (node.type !== "Identifier" || node.name !== RETURN_FUNCTION) return false;
  const parent = path.at(-1);
  const declared = declaresFunction(node, parent);
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
      if (isStrayName(node, path) || isComputedKey(node) || isMetaTool(node) || isForbiddenText(node)) stray += 1;
      if (isStrayReturnFunction(node, path)) strayCalls += 1;
    });
  }
  stray += strayTimers(names);
  const reads = calls.map(({ node }) => node.arguments.map((read) => read.arguments[0]?.name));
  const [first = [], ...others] = reads;
  const agreed = (name, position) => others.every((names) => names[position] === name);
  return {
    passed: new Map(first.flatMap((name, position) => (agreed(name, position) ? [[name, position]] : []))),
    fromLocation: stray === 0 && calls.every((call) => isSetBeforeCall(call, names)),
    callsClear: strayCalls === 0,
    calls,
    names,
  };
}

function isNamed(node, name) {
  return node.type === "Identifier" && node.name === name;
}

function onlyCompared(uses, name, side) {
  const compared = ({ node, parent }) => parent.type === "BinaryExpression" && parent.operator === "===" && parent[side] === node;
  return uses.filter(({ node }) => node.name === name).every(compared);
}

function hasBranch(body, arg, valueConst) {
  const compares = ({ test }) => test.operator === "===" && isNamed(test.left, arg) && isNamed(test.right, valueConst);
  return body.some((statement) => statement.type === "IfStatement" && compares(statement));
}

function isParamsGetArgument({ node, parent }) {
  return isParamsGet(parent) && parent.arguments[0] === node;
}

function paramConstantProblem({ blockUses }, paramConst) {
  const uses = blockUses.filter(({ node }) => node.name === paramConst);
  if (uses.every(isParamsGetArgument)) return undefined;
  return `${paramConst} steht ausserhalb von params.get(${paramConst}) und kann ueberdeckt sein`;
}

function callsWithin({ calls }, scope) {
  return calls.every((call) => call.path.includes(scope));
}

function runsAfter({ node, path }, context, visiting) {
  const { scope, end, names } = context;
  if (!path.includes(scope)) return false;
  const outside = path.slice(0, path.indexOf(scope));
  const boundary = path.slice(outside.length + 1).findLast((step) => FUNCTION_NODES.has(step.type));
  if (boundary === undefined) return node.range[0] >= end && isInvoked(outside, names, visiting);
  return isCalledOnly(boundary, { names, visiting }, (call, inside) => runsAfter(call, context, inside));
}

function runsAfterCalls({ calls, names }, scope, end) {
  return calls.every((call) => runsAfter(call, { scope, end, names }, new Set()));
}

function lateConstantProblem(shell, constNames) {
  const declaredLate = (name) => {
    const { program, end } = shell.declarations.get(name);
    return !runsAfterCalls(shell, program, end);
  };
  const late = constNames.find(declaredLate);
  return late && `${late} ist beim Aufruf von returnMessageText noch nicht deklariert`;
}

function callProblem(shell, paramConst) {
  if (!shell.passed.has(paramConst)) return `die Shell gibt ${paramConst} nicht an returnMessageText weiter`;
  if (!shell.callsClear) return UNCLEAR_CALL;
  if (!callsWithin(shell, shell.functionScope)) return HIDDEN_FUNCTION;
  return shell.fromLocation ? undefined : NOT_FROM_LOCATION;
}

function branchProblem(shell, paramConst, valueConst) {
  if (!shell.found) return "die Shell hat keine Funktion returnMessageText()";
  if (!shell.branch) return "es gibt mehr als eine Funktion returnMessageText()";
  const problem = callProblem(shell, paramConst) ?? paramConstantProblem(shell, paramConst) ?? lateConstantProblem(shell, [paramConst, valueConst]);
  if (problem) return problem;
  const arg = shell.branch.args[shell.passed.get(paramConst)];
  const compared = onlyCompared(shell.branch.argUses, arg, "left") && onlyCompared(shell.blockUses, valueConst, "right");
  if (!compared) return `${arg} oder ${valueConst} steht ausserhalb eines Vergleichs "${arg} === ${valueConst}" und kann ueberdeckt sein`;
  if (hasBranch(shell.branch.body, arg, valueConst)) return undefined;
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
  const markup = shell.markupFindings.map(({ line, text }) => ({ file: SHELL_FILE, line, text }));
  const targets = Object.entries(checkoutReturn).flatMap(([name, target]) => {
    const { param, value } = returnParts(target);
    return targetProblems(shell, param, value).map((problem) => ({
      file: SHELL_FILE,
      line: shell.line,
      text: `${name}: ${problem}`,
    }));
  });
  return [...markup, ...targets];
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

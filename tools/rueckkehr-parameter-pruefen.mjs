import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_USAGE = 2;
const SHELL_FILE = "apps/web/src/components/app/BillingIsland.astro";
const PORTAL_PATHS_FILE = "src/portal-paths.js";
const WEB_SOURCE_DIR = "apps/web/src";
const CARD_PARAM = "card";
const RETURN_CONSTANT = /const (RETURN_\w+) = "([^"]+)";/g;
const RETURN_PARAM_PREFIX = /^RETURN_PARAM_/;
const RETURN_FUNCTION = /function returnMessageText\(([^)]*)\)\s*\{([\s\S]*?)\n {2}\}/;
const SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
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

function readShell(file) {
  const source = readFileSync(file, "utf8");
  const constants = new Map();
  for (const match of source.matchAll(RETURN_CONSTANT)) constants.set(match[2], match[1]);
  const found = RETURN_FUNCTION.exec(source);
  const branch = found && { args: found[1].split(",").map((arg) => arg.trim()), body: found[2] };
  return { source, constants, branch, line: found ? lineAt(source, found.index) : 1 };
}

const IDENTIFIER_CHAR = /[\w$]/;

function containsWholeName(text, part) {
  let index = text.indexOf(part);
  while (index !== -1) {
    if (!IDENTIFIER_CHAR.test(text.charAt(index + part.length))) return true;
    index = text.indexOf(part, index + 1);
  }
  return false;
}

function branchProblem(shell, param, valueConst) {
  if (!shell.branch) return "die Shell hat keine Funktion returnMessageText()";
  const arg = shell.branch.args[param === CARD_PARAM ? 0 : 1];
  if (containsWholeName(shell.branch.body, `${arg} === ${valueConst}`)) return undefined;
  return `kein Zweig "${arg} === ${valueConst}" - der Fall bleibt fuer den Kunden stumm`;
}

function targetProblems(shell, param, value) {
  const paramConst = shell.constants.get(param);
  if (paramConst === undefined) return [`die Shell kennt den Parameter "${param}" nicht`];
  const problems = [];
  if (!RETURN_PARAM_PREFIX.test(paramConst)) problems.push(`"${param}" ist keine Parameter-Konstante`);
  if (!shell.source.includes(`params.get(${paramConst})`)) {
    problems.push(`die Shell liest ${paramConst} nicht aus der Query`);
  }
  const valueConst = shell.constants.get(value);
  if (valueConst === undefined) return [...problems, `die Shell kennt den Wert "${value}" nicht`];
  const missingBranch = branchProblem(shell, param, valueConst);
  return missingBranch ? [...problems, missingBranch] : problems;
}

function shellFindings(root, checkoutReturn) {
  const file = join(root, SHELL_FILE);
  const shell = readShell(file);
  return Object.entries(checkoutReturn).flatMap(([name, target]) => {
    const { param, value } = returnParts(target);
    return targetProblems(shell, param, value).map((problem) => ({
      file: SHELL_FILE,
      line: shell.line,
      text: `${name}: ${problem}`,
    }));
  });
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

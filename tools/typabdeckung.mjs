import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import ts from "typescript";

import { PRUEFUNG, zweckBlock } from "./auftrag/zweck.mjs";
import { fileAt } from "./pruefungen-messen.mjs";
import { CHECKED_ROOTS, TYPESCRIPT_FILE, isCommit } from "./ts-dateien.mjs";

const CONFIG_FILE = "tsconfig.json";
const FLOOR_FILE = "tools/basis/typabdeckung.json";
const FULL_PERCENT = 100;
const INVALID_FLOOR = "mindestens fehlt oder liegt nicht zwischen 0 und 100";
const PERCENT_DIGITS = 2;
const NOT_COUNTED = undefined;
const COVERED = null;
const EXIT_FINDING = 1;
const LINE_BREAK = "\n";
const LABEL_LENGTH = 40;
const ELLIPSIS = "…";
const DIRECTIVE = /@ts-[a-z-]+/;
const NOCHECK_DIRECTIVE = "@ts-nocheck";
const NAMED_ELSEWHERE = new Set([
  ts.SyntaxKind.PropertyAccessExpression,
  ts.SyntaxKind.ParenthesizedExpression,
]);

function relativePath(root, path) {
  return relative(root, path).split("\\").join("/");
}

function isCheckedFile(root, path) {
  const file = relativePath(root, path);
  return TYPESCRIPT_FILE.test(file) && CHECKED_ROOTS.some((prefix) => file.startsWith(prefix));
}

function parsedConfig(root) {
  const { config, error } = ts.readConfigFile(resolve(root, CONFIG_FILE), ts.sys.readFile);
  if (error !== undefined)
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, LINE_BREAK));
  return ts.parseJsonConfigFileContent(config, ts.sys, root);
}

function hasFlag(value, flag) {
  return (value & flag) !== 0;
}

function typeArguments(checker, type) {
  const isReference =
    hasFlag(type.flags, ts.TypeFlags.Object) && hasFlag(type.objectFlags, ts.ObjectFlags.Reference);
  return isReference ? checker.getTypeArguments(type) : [];
}

function containsAny(checker, type, seen) {
  if (hasFlag(type.flags, ts.TypeFlags.Any)) return true;
  if (seen.has(type)) return false;
  seen.add(type);
  const parts = type.isUnionOrIntersection() ? type.types : [];
  return [...parts, ...typeArguments(checker, type)].some((part) =>
    containsAny(checker, part, seen),
  );
}

function assertionLabel(node, sourceFile) {
  if (ts.isNonNullExpression(node)) return "!";
  if (!ts.isAsExpression(node) && !ts.isTypeAssertionExpression(node)) return NOT_COUNTED;
  return ts.isConstTypeReference(node.type) ? NOT_COUNTED : `as ${node.type.getText(sourceFile)}`;
}

function expressionLabel(node, sourceFile) {
  const text = node.getText(sourceFile).replace(/\s+/g, " ");
  return text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH)}${ELLIPSIS}` : text;
}

function isCountedExpression(node) {
  return ts.isExpression(node) && !ts.isLiteralExpression(node) && !NAMED_ELSEWHERE.has(node.kind);
}

function nodeLabel(checker, node, sourceFile) {
  const hasAny = () => containsAny(checker, checker.getTypeAtLocation(node), new Set());
  if (ts.isIdentifier(node)) return hasAny() ? node.text : COVERED;
  const assertion = assertionLabel(node, sourceFile);
  if (assertion !== NOT_COUNTED || !isCountedExpression(node)) return assertion;
  return hasAny() ? expressionLabel(node, sourceFile) : COVERED;
}

function directives(sourceFile) {
  const { checkJsDirective, commentDirectives = [] } = sourceFile;
  const nocheck = checkJsDirective?.enabled === false ? [checkJsDirective.pos] : [];
  return [...nocheck, ...commentDirectives.map(({ range }) => range.pos)].map((pos) => {
    const comment = sourceFile.text.slice(pos);
    return { pos, label: DIRECTIVE.exec(comment)?.[0] ?? NOCHECK_DIRECTIVE };
  });
}

function position(file, sourceFile, pos) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
  return `${file}:${line + 1}:${character + 1}`;
}

function measureFile(checker, root, sourceFile) {
  const file = relativePath(root, sourceFile.fileName);
  const found = directives(sourceFile);
  const result = {
    counted: found.length,
    findings: found.map(({ pos, label }) => `${position(file, sourceFile, pos)} ${label}`),
  };
  const visit = (node) => {
    if (ts.isConstTypeReference(node)) return;
    const label = nodeLabel(checker, node, sourceFile);
    if (label !== NOT_COUNTED) result.counted += 1;
    if (typeof label === "string") {
      result.findings.push(`${position(file, sourceFile, node.getStart(sourceFile))} ${label}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function measureCoverage(root) {
  const config = parsedConfig(root);
  const files = config.fileNames.filter((path) => isCheckedFile(root, path));
  if (files.length === 0) return { files: 0, counted: 0, findings: [] };
  const program = ts.createProgram(files, config.options);
  const checker = program.getTypeChecker();
  const measured = program
    .getSourceFiles()
    .filter((sourceFile) => isCheckedFile(root, sourceFile.fileName))
    .map((sourceFile) => measureFile(checker, root, sourceFile));
  return {
    files: measured.length,
    counted: measured.reduce((sum, { counted }) => sum + counted, 0),
    findings: measured.flatMap(({ findings }) => findings),
  };
}

function floorOf(text) {
  try {
    const floor = JSON.parse(text).mindestens;
    return Number.isFinite(floor) && floor >= 0 && floor <= FULL_PERCENT ? floor : undefined;
  } catch {
    return undefined;
  }
}

function fullFloorWith(finding) {
  return { floor: FULL_PERCENT, findings: [finding] };
}

function floorFindings(root, basis) {
  if (basis !== undefined && !isCommit(basis))
    return fullFloorWith(
      `--basis ${JSON.stringify(basis)} ist kein lesbarer Commit; ohne Basis lässt sich die Untergrenze nicht vergleichen.`,
    );
  const floor = floorOf(readFileSync(resolve(root, FLOOR_FILE), "utf8"));
  if (floor === undefined) return fullFloorWith(`${FLOOR_FILE}: ${INVALID_FLOOR}.`);
  const beforeText = basis === undefined ? undefined : fileAt(basis, FLOOR_FILE);
  if (beforeText === undefined) return { floor, findings: [] };
  const before = floorOf(beforeText);
  if (before === undefined)
    return fullFloorWith(
      `${basis}:${FLOOR_FILE}: ${INVALID_FLOOR}; ohne gültige Basis lässt sich die Untergrenze nicht vergleichen.`,
    );
  if (floor >= before) return { floor, findings: [] };
  return {
    floor,
    findings: [
      `${FLOOR_FILE}: mindestens ist von ${before} auf ${floor} gesunken; die Untergrenze darf nur steigen.`,
    ],
  };
}

function percent({ counted, findings }) {
  return counted === 0 ? FULL_PERCENT : ((counted - findings.length) * FULL_PERCENT) / counted;
}

function report(root, basis) {
  const coverage = measureCoverage(root);
  const floor = floorFindings(root, basis);
  const covered = percent(coverage);
  for (const finding of coverage.findings) console.error(finding);
  const summary = `Typabdeckung: ${coverage.counted - coverage.findings.length} von ${coverage.counted} Stellen ohne any in ${coverage.files} TypeScript-Dateien (${covered.toFixed(PERCENT_DIGITS)} %), Untergrenze ${floor.floor} % aus ${FLOOR_FILE}.`;
  console.log(summary);
  const failed = covered < floor.floor || floor.findings.length > 0;
  for (const finding of floor.findings) console.error(finding);
  if (failed) console.error(zweckBlock(PRUEFUNG.TYPPRUEFUNG).join(LINE_BREAK));
  return failed ? EXIT_FINDING : 0;
}

const { values } = parseArgs({ options: { basis: { type: "string" } } });
process.exitCode = report(process.cwd(), values.basis);

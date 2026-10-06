import { posix } from "node:path";
import { VisitorKeys, parse } from "espree";

import { quelltextLesestellen } from "../eslint-rules/kein-quelltext-als-text.js";
import { alleKnoten } from "../eslint-rules/knoten.js";
import {
  gatesAt,
  git,
  isJavaScript,
  sourceTypeOf,
  staticTestName,
  testSource,
} from "./aenderungen.mjs";

const STATUS_MODIFIED = "M";
const STATUS_DELETED = "D";
const RENAME_STATUS = "R";
const SINGLE_PATH_FIELDS = 2;
const PAIRED_PATH_FIELDS = 3;
const POSITION_FIELDS = new Set(["start", "end", "range", "loc"]);
const IMPORT_NODES = new Set([
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
  "ImportExpression",
]);
const RELATIVE_SOURCE = /^\.\.?\//;
const DECLARATIONS = new Set(["Variable", "FunctionName"]);
const ALLOWED_MODULES = new Set([
  "test",
  "assert",
  "assert/strict",
  "fs",
  "fs/promises",
  "path",
  "url",
]);
const STATIC_IMPORTS = new Set([
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
]);
const DYNAMIC_IMPORT = "ImportExpression";
const CODE_NAMES = new Set(["require", "eval", "Function"]);
const NODE_PREFIX = "node:";
const COMMENTS_ONLY = "nur Kommentare oder Leerraum geändert (Syntaxbaum gleich)";
const TEXT_TESTS_ONLY =
  "gelöscht, nur Tests, die Quelltext oder Dokumente als Text lesen (Regel 31)";

function remembered(compute) {
  let value;
  return () => {
    value ??= compute();
    return value;
  };
}

function fileAt(commit, file) {
  return git(["show", `${commit}:${file}`]);
}

function renamesSince(basis) {
  const fields = git(["diff", "--find-renames", "--name-status", "-z", basis, "HEAD"]).split("\0");
  const renames = new Map();
  let index = 0;
  while (index + 1 < fields.length) {
    const [status, before, after] = fields.slice(index, index + PAIRED_PATH_FIELDS);
    const isRename = status.startsWith(RENAME_STATUS);
    if (isRename) renames.set(before, after);
    index += isRename ? PAIRED_PATH_FIELDS : SINGLE_PATH_FIELDS;
  }
  return renames;
}

function syntaxTree(file, text) {
  try {
    return parse(text, { ecmaVersion: "latest", sourceType: sourceTypeOf(file) });
  } catch {
    return null;
  }
}

function withoutPositions(key, value) {
  if (POSITION_FIELDS.has(key)) return undefined;
  return typeof value === "bigint" ? `${value}n` : value;
}

function treeText(tree) {
  return JSON.stringify(tree, withoutPositions);
}

function relativeSources(tree) {
  const nodes = alleKnoten({ ast: tree, visitorKeys: VisitorKeys });
  const sources = nodes
    .filter(({ type, source }) => IMPORT_NODES.has(type) && typeof source?.value === "string")
    .map(({ source }) => source);
  const relative = sources.filter(({ value }) => RELATIVE_SOURCE.test(value));
  return relative.toSorted((left, right) => left.start - right.start);
}

function followRenames(tree, file, renames) {
  const followed = new Map();
  for (const source of relativeSources(tree)) {
    const resolved = posix.join(posix.dirname(file), source.value);
    const target = renames.get(resolved) ?? resolved;
    if (target !== resolved) followed.set(resolved, target);
    source.value = target;
    source.raw = `${source.raw.at(0)}${target}${source.raw.at(-1)}`;
  }
  return followed;
}

function renameReason(followed) {
  const pairs = [...followed].map(([before, after]) => `von ${before} nach ${after}`);
  return `Importpfad folgt der Umbenennung ${pairs.join(", ")}`;
}

function modifiedReason(context, file) {
  const before = syntaxTree(file, fileAt(context.basis, file));
  const after = syntaxTree(file, fileAt("HEAD", file));
  if (before === null || after === null) return undefined;
  if (treeText(before) === treeText(after)) return COMMENTS_ONLY;
  const followed = followRenames(before, file, context.renames());
  followRenames(after, file, new Map());
  const same = followed.size > 0 && treeText(before) === treeText(after);
  return same ? renameReason(followed) : undefined;
}

function encloses(outer, inner) {
  return outer.range[0] <= inner.range[0] && inner.range[1] <= outer.range[1];
}

function isPlainAssignment({ identifier }) {
  const { parent } = identifier;
  return (
    parent.type === "AssignmentExpression" && parent.operator === "=" && parent.left === identifier
  );
}

function assignedFrom(variable) {
  const declared = variable.defs
    .filter(({ type }) => DECLARATIONS.has(type))
    .map(({ node }) => node);
  const assigned = variable.references
    .filter(isPlainAssignment)
    .map(({ identifier }) => identifier.parent.right);
  return [...declared, ...assigned];
}

function isFed(node, { reads, fed, references }) {
  if (reads.some((read) => encloses(node, read))) return true;
  return references.some(
    ({ resolved, identifier }) => fed.has(resolved) && encloses(node, identifier),
  );
}

function fedVariables(sourceCode, reads) {
  const { scopes } = sourceCode.scopeManager;
  const references = scopes.flatMap((scope) => scope.references);
  const variables = scopes.flatMap((scope) => scope.variables);
  const state = { reads, fed: new Set(), references };
  let added = variables;
  while (added.length > 0) {
    added = variables.filter(
      (variable) =>
        !state.fed.has(variable) && assignedFrom(variable).some((node) => isFed(node, state)),
    );
    for (const variable of added) state.fed.add(variable);
  }
  return state;
}

function leafTests(calls) {
  const leaves = calls.filter(
    (call) => !calls.some((other) => other !== call && encloses(call, other)),
  );
  return leaves.toSorted((left, right) => left.range[0] - right.range[0]);
}

function findingDetails(unlinked, executes) {
  const names = unlinked.map((name) => `„${name}“`).join(", ");
  return [
    ...(unlinked.length > 0 ? [`Ohne Lesestelle sind: ${names}.`] : []),
    ...(executes.length > 0 ? [`Die Datei kann Code ausführen: ${executes.join(", ")}.`] : []),
  ];
}

function testLabel(call) {
  return staticTestName(call.arguments[0]) ?? `Zeile ${call.loc.start.line}`;
}

function isAllowedModule(source) {
  const name = source.startsWith(NODE_PREFIX) ? source.slice(NODE_PREFIX.length) : source;
  return ALLOWED_MODULES.has(name);
}

function codeProblem(node) {
  if (node.type === DYNAMIC_IMPORT) return "lädt Code mit import() nach";
  const name = node.type === "Literal" ? node.value : node.name;
  if (CODE_NAMES.has(name)) return `nennt ${name}`;
  const source = STATIC_IMPORTS.has(node.type) ? node.source?.value : undefined;
  return source === undefined || isAllowedModule(source) ? undefined : `bindet ${source} ein`;
}

function codeExecution(sourceCode) {
  const nodes = alleKnoten(sourceCode).toSorted((left, right) => left.range[0] - right.range[0]);
  return [...new Set(nodes.map(codeProblem).filter(Boolean))];
}

function deletedVerdict(context, file) {
  if (context.gates().has(file)) return {};
  const parsed = testSource(file, fileAt(context.basis, file));
  const reads = parsed === undefined ? [] : quelltextLesestellen(parsed.sourceCode, file);
  if (reads.length === 0) return {};
  const state = fedVariables(parsed.sourceCode, reads);
  const leaves = leafTests(parsed.calls);
  const unlinked = leaves.filter((leaf) => !isFed(leaf, state)).map(testLabel);
  const executes = codeExecution(parsed.sourceCode);
  const linked = leaves.length > 0 && unlinked.length === 0;
  if (linked && executes.length === 0) return { reason: TEXT_TESTS_ONLY };
  return { details: findingDetails(unlinked, executes) };
}

function verdict(context, { status, file }) {
  if (!isJavaScript(file)) return {};
  if (status === STATUS_MODIFIED) return { reason: modifiedReason(context, file) };
  return status === STATUS_DELETED ? deletedVerdict(context, file) : {};
}

export function mechanicalProofs(basis, changes) {
  const context = {
    basis,
    renames: remembered(() => renamesSince(basis)),
    gates: remembered(() => gatesAt(basis)),
  };
  const verdicts = changes.map((change) => ({ change, ...verdict(context, change) }));
  return {
    open: verdicts
      .filter(({ reason }) => reason === undefined)
      .map(({ change, details = [] }) => ({ ...change, details })),
    proven: verdicts
      .filter(({ reason }) => reason !== undefined)
      .map(({ change, reason }) => `Testschutz: ${change.file}: ${reason}.`),
  };
}

export function deletedFinding({ file, details }) {
  const finding = `${file}: die ganze Testdatei ist gelöscht; das ist immer gesperrt.`;
  return [finding, ...details].join(" ");
}

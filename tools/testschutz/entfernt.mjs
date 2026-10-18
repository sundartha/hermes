import { VisitorKeys } from "espree";

import { alleKnoten } from "../eslint-rules/knoten.js";
import { laufzeitText } from "../umbenennung.mjs";
import { git, isJavaScript, staticTestName, testSource } from "./aenderungen.mjs";
import { encloses, syntaxTree, treeText } from "./ausnahmen.mjs";

const LINE_BREAK = "\n";

function namedCalls(file, text) {
  const calls = testSource(file, text)?.calls ?? [];
  return calls.map((call) => ({ call, name: staticTestName(call.arguments[0]) }));
}

function standsAlone(call, calls) {
  return calls.every(
    ({ call: other }) => other === call || (!encloses(call, other) && !encloses(other, call)),
  );
}

function span({ start, end }) {
  return `${start}-${end}`;
}

function calledExpression({ type, expression }) {
  if (type !== "ExpressionStatement") return undefined;
  return expression.type === "AwaitExpression" ? expression.argument : expression;
}

function statementsByCall(tree) {
  const statements = new Map();
  const nodes = alleKnoten({ ast: tree, visitorKeys: VisitorKeys });
  for (const block of nodes.filter(({ body }) => Array.isArray(body))) {
    for (const statement of block.body) {
      const call = calledExpression(statement);
      if (call !== undefined) statements.set(span(call), { block, statement });
    }
  }
  return statements;
}

function lineAt(text, offset) {
  return text.slice(0, offset).split(LINE_BREAK).length;
}

function candidates({ file, before, after, tree }) {
  const remaining = new Set(namedCalls(file, after).map(({ name }) => name));
  const calls = namedCalls(file, before);
  const statements = statementsByCall(tree);
  const runtime = laufzeitText(file, before);
  return calls
    .filter(({ name }) => name !== undefined && !remaining.has(name))
    .filter(({ call }) => standsAlone(call, calls) && statements.has(span(call)))
    .map(({ call, name }) => {
      const found = statements.get(span(call));
      const { start, end } = found.statement;
      return { ...found, name, first: lineAt(runtime, start), last: lineAt(runtime, end) };
    });
}

function withoutStatements(removed) {
  const bodies = new Map();
  for (const { block, statement } of removed) {
    const left = bodies.get(block.body) ?? block.body;
    bodies.set(
      block.body,
      left.filter((entry) => entry !== statement),
    );
  }
  return bodies;
}

function isBlank(line) {
  return line.trim() === "";
}

function blankAt(lines, line) {
  const text = lines[line - 1];
  return text !== undefined && isBlank(text);
}

function optionalBlank(lines, { first, last }) {
  const [above, below] = [first - 1, last + 1];
  if (blankAt(lines, below)) return below;
  return blankAt(lines, above) ? above : undefined;
}

function expectedLines(before, removed) {
  const lines = before.split(LINE_BREAK);
  const inside = (line) => removed.some(({ first, last }) => first <= line && line <= last);
  const optional = new Set(removed.map((range) => optionalBlank(lines, range)));
  return lines
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ line }) => !inside(line))
    .map(({ text, line }) => ({ text, optional: optional.has(line) }));
}

function sections(lines) {
  const result = [{ blank: 0, optional: 0 }];
  for (const { text, optional = false } of lines) {
    const gap = result.at(-1);
    if (!isBlank(text)) result.push({ text }, { blank: 0, optional: 0 });
    else if (optional) gap.optional += 1;
    else gap.blank += 1;
  }
  return result;
}

function sameSection(expected, actual) {
  if (expected.text !== undefined) return expected.text === actual.text;
  return (
    actual.text === undefined &&
    expected.blank <= actual.blank &&
    actual.blank <= expected.blank + expected.optional
  );
}

function sameLines(before, after, removed) {
  const expected = sections(expectedLines(before, removed));
  const actual = sections(after.split(LINE_BREAK).map((text) => ({ text })));
  return (
    expected.length === actual.length &&
    expected.every((section, index) => sameSection(section, actual[index]))
  );
}

export function removedCases(basis, file, after) {
  if (!isJavaScript(file)) return [];
  const before = git(["show", `${basis}:${file}`]);
  const tree = syntaxTree(file, laufzeitText(file, before));
  const treeAfter = syntaxTree(file, laufzeitText(file, after));
  if (tree === null || treeAfter === null) return [];
  const removed = candidates({ file, before, after, tree });
  const exact =
    removed.length > 0 &&
    treeText(tree, withoutStatements(removed)) === treeText(treeAfter) &&
    sameLines(before, after, removed);
  return exact ? removed.map(({ name }) => name) : [];
}

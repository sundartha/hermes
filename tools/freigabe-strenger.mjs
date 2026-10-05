import { isDeepStrictEqual } from "node:util";

import { fileAt } from "./pruefungen-messen.mjs";

export const STRENGER = "strenger";

const FALL_ALTBEFUNDE = "(a) Altbefunde gestrichen";
const FALL_TESTDATEI = "(c) neue Testdatei";
const STATUS_ADDED = "A";
const STATUS_MODIFIED = "M";
const TEST_FILE = /^test\/.+\.test\.js$/;
const TEXT_LIST_SUFFIX = ".txt";
const LINE_BREAK = "\n";
const WHOLE_FILE = "";

const OLD_FINDING_LISTS = new Map([
  ["tools/basis/jscpd.json", "befunde"],
  ["tools/basis/knip.json", "befunde"],
  ["tools/basis/semgrep.json", "befunde"],
  ["tools/basis/quelltext-als-text.json", "befunde"],
  ["tools/basis/lessons.json", "befunde"],
  ["tools/basis/anweisungen.json", "befunde"],
  ["tools/basis/wurzel.json", "befunde"],
  ["tools/basis/selbstpruefung.json", "befunde"],
  ["tools/basis/fester-importpfad.json", "befunde"],
  ["tools/basis/test-importe.json", WHOLE_FILE],
  ["tools/basis/lieferkette-ausnahmen.json", WHOLE_FILE],
  ["tools/basis/katalog-ohne-test.txt", WHOLE_FILE],
]);

function parsed(commit, path) {
  const text = fileAt(commit, path);
  if (text === undefined) return undefined;
  if (path.endsWith(TEXT_LIST_SUFFIX)) return text.split(LINE_BREAK);
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listParts(content, key) {
  if (key === WHOLE_FILE) return { entries: content, rest: undefined };
  if (!isRecord(content)) return { entries: undefined, rest: content };
  const { [key]: entries, ...rest } = content;
  return { entries, rest };
}

function isShorterSubsequence(shorter, longer) {
  let index = 0;
  for (const entry of shorter) {
    while (index < longer.length && !isDeepStrictEqual(longer[index], entry)) index += 1;
    if (index === longer.length) return false;
    index += 1;
  }
  return shorter.length < longer.length;
}

function onlyDropsEntries(before, after, key) {
  const [old, current] = [listParts(before, key), listParts(after, key)];
  if (!Array.isArray(old.entries) || !Array.isArray(current.entries)) return false;
  return (
    isDeepStrictEqual(old.rest, current.rest) && isShorterSubsequence(current.entries, old.entries)
  );
}

const RULES = [
  { fall: FALL_ALTBEFUNDE, settings: OLD_FINDING_LISTS, holds: onlyDropsEntries },
];

function stricterCase(basis, { status, path }) {
  if (status === STATUS_ADDED) return TEST_FILE.test(path) ? FALL_TESTDATEI : undefined;
  const rule = RULES.find(({ settings }) => settings.has(path));
  if (status !== STATUS_MODIFIED || rule === undefined) return undefined;
  const holds = rule.holds(parsed(basis, path), parsed("HEAD", path), rule.settings.get(path));
  return holds ? rule.fall : undefined;
}

export function stricterCases(basis, changes) {
  const cases = changes.map((change) => ({ path: change.path, fall: stricterCase(basis, change) }));
  const isStricter = cases.length > 0 && cases.every(({ fall }) => fall !== undefined);
  return isStricter ? cases : undefined;
}

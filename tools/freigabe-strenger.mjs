import { isDeepStrictEqual } from "node:util";

import { fileAt } from "./pruefungen-messen.mjs";

export const STRENGER = "strenger";

const FALL_ALTBEFUNDE = "(a) Altbefunde gestrichen";
const FALL_GRENZE = "(b) Obergrenze gesenkt";
const FALL_TESTDATEI = "(c) neue Testdatei";
const STATUS_ADDED = "A";
const STATUS_MODIFIED = "M";
const TEST_FILE = /^test\/.+\.test\.js$/;
const TEXT_LIST_SUFFIX = ".txt";
const LINE_BREAK = "\n";
const WHOLE_FILE = "";
const ANY_KEY = Symbol("jeder Schlüssel");

const OLD_FINDING_LISTS = new Map([
  ["tools/basis/jscpd.json", "befunde"],
  ["tools/basis/knip.json", "befunde"],
  ["tools/basis/semgrep.json", "befunde"],
  ["tools/basis/lieferkette-ausnahmen.json", WHOLE_FILE],
  ["tools/basis/katalog-ohne-test.txt", WHOLE_FILE],
]);

const UPPER_LIMITS = new Map([
  ["tools/basis/riesendateien.json", [[ANY_KEY]]],
  ["tools/basis/testverhaeltnis.json", [["produkt", "obergrenze"]]],
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

function* differences(before, after, path = []) {
  if (isDeepStrictEqual(before, after)) return;
  const keys = isRecord(before) && isRecord(after) ? Object.keys(before) : [];
  if (keys.length === 0 || !isDeepStrictEqual(keys.toSorted(), Object.keys(after).toSorted())) {
    yield { path, before, after };
    return;
  }
  for (const key of keys) yield* differences(before[key], after[key], [...path, key]);
}

function isLimit(patterns, path) {
  return patterns.some(
    (pattern) =>
      pattern.length === path.length &&
      pattern.every((key, index) => key === ANY_KEY || key === path[index]),
  );
}

function onlyLowersLimits(before, after, patterns) {
  const found = [...differences(before, after)];
  return (
    found.length > 0 &&
    found.every(
      (difference) =>
        isLimit(patterns, difference.path) &&
        typeof difference.before === "number" &&
        typeof difference.after === "number" &&
        difference.after < difference.before,
    )
  );
}

const RULES = [
  { fall: FALL_ALTBEFUNDE, settings: OLD_FINDING_LISTS, holds: onlyDropsEntries },
  { fall: FALL_GRENZE, settings: UPPER_LIMITS, holds: onlyLowersLimits },
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

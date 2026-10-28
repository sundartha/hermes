import { isDeepStrictEqual } from "node:util";

import { fileAt } from "./pruefungen-messen.mjs";

export const STRENGER = "strenger";

const FALL_ALTBEFUNDE = "(a) Altbefunde gestrichen";
const FALL_TESTDATEI = "(c) neue Testdatei";
const FALL_KARTE = "(d) Bausteinkarte nur strenger";
const KARTE = "tools/bausteine.json";
const ALLE_EINGAENGE = "alle";
const KARTE_SCHLUESSEL = new Set(["schichten", "bausteine", "altlast"]);
const BAUSTEIN_FELDER = new Set(["baustein", "zweck", "quellen", "eingaenge", "nutzt", "importiertJedeDatei"]);
const STATUS_ADDED = "A";
const STATUS_MODIFIED = "M";
const TEST_FILE = /^test\/.+\.test\.js$/;
const TEXT_LIST_SUFFIX = ".txt";
const LINE_BREAK = "\n";
const WHOLE_FILE = "";
const SUPPRESSION_COUNTS = "count";

export const OLD_FINDING_LISTS = new Map([
  ["tools/basis/jscpd.json", "befunde"],
  ["tools/basis/knip.json", "befunde"],
  ["tools/basis/semgrep.json", "befunde"],
  ["tools/basis/quelltext-als-text.json", "befunde"],
  ["tools/basis/lessons.json", "befunde"],
  ["tools/basis/anweisungen.json", "befunde"],
  ["tools/basis/wurzel.json", "befunde"],
  ["tools/basis/selbstpruefung.json", "befunde"],
  ["tools/basis/fester-importpfad.json", "befunde"],
  ["tools/basis/keine-speicher-attrappe.json", "befunde"],
  ["tools/basis/test-importe.json", WHOLE_FILE],
  ["tools/basis/lieferkette-ausnahmen.json", WHOLE_FILE],
  ["tools/basis/katalog-ohne-test.txt", WHOLE_FILE],
  ["tools/basis/funktionskarte-offen.json", WHOLE_FILE],
  ["eslint-suppressions.json", SUPPRESSION_COUNTS],
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

function isLowerCount(before, after) {
  const entryKeys = Object.keys(after ?? {});
  const sameShape = entryKeys.length === 1 && entryKeys[0] === SUPPRESSION_COUNTS;
  const count = after?.[SUPPRESSION_COUNTS];
  return sameShape && Number.isInteger(count) && count > 0 && count <= before?.[SUPPRESSION_COUNTS];
}

function countEntries(content) {
  if (!isRecord(content)) return undefined;
  const files = Object.values(content);
  if (!files.every(isRecord)) return undefined;
  return Object.entries(content).flatMap(([file, rules]) =>
    Object.entries(rules).map(([rule, entry]) => ({ file, rule, entry })),
  );
}

export function onlyLowersCounts(before, after) {
  const [old, current] = [countEntries(before), countEntries(after)];
  if (old === undefined || current === undefined) return false;
  const holds = current.every(({ file, rule, entry }) => isLowerCount(before[file]?.[rule], entry));
  const addsNoFile = Object.keys(after).every((file) => Object.hasOwn(before, file));
  return holds && addsNoFile && !isDeepStrictEqual(before, after);
}

function onlyDropsEntries(before, after, key) {
  if (key === SUPPRESSION_COUNTS) return onlyLowersCounts(before, after);
  const [old, current] = [listParts(before, key), listParts(after, key)];
  if (!Array.isArray(old.entries) || !Array.isArray(current.entries)) return false;
  return (
    isDeepStrictEqual(old.rest, current.rest) && isShorterSubsequence(current.entries, old.entries)
  );
}

function keepsOrDrops(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return false;
  return isDeepStrictEqual(before, after) || isShorterSubsequence(after, before);
}

function entrancesStricter(before, after) {
  if (after === ALLE_EINGAENGE) return before === ALLE_EINGAENGE;
  return before === ALLE_EINGAENGE ? Array.isArray(after) : keepsOrDrops(before, after);
}

function blockStricter(before, after) {
  if (before === undefined || !Object.keys(after).every((key) => BAUSTEIN_FELDER.has(key))) return false;
  const freeBefore = before.importiertJedeDatei === true;
  return (
    isDeepStrictEqual([before.zweck, before.quellen], [after.zweck, after.quellen]) &&
    entrancesStricter(before.eingaenge, after.eingaenge) &&
    keepsOrDrops(before.nutzt ?? [], after.nutzt ?? []) &&
    (after.importiertJedeDatei !== true || freeBefore)
  );
}

function sameKnownKeys(before, after) {
  const [oldKeys, newKeys] = [Object.keys(before).toSorted(), Object.keys(after).toSorted()];
  return isDeepStrictEqual(oldKeys, newKeys) && newKeys.every((key) => KARTE_SCHLUESSEL.has(key));
}

export function onlyTightensMap(before, after) {
  if (!isRecord(before) || !isRecord(after) || !Array.isArray(after.bausteine)) return false;
  const sameShape = sameKnownKeys(before, after);
  const named = new Map((before.bausteine ?? []).map((block) => [block.baustein, block]));
  const sameBlocks = isDeepStrictEqual([...named.keys()], after.bausteine.map(({ baustein }) => baustein));
  return (
    sameShape &&
    sameBlocks &&
    isDeepStrictEqual(before.schichten, after.schichten) &&
    after.bausteine.every((block) => blockStricter(named.get(block.baustein), block)) &&
    keepsOrDrops(before.altlast, after.altlast) &&
    !isDeepStrictEqual(before, after)
  );
}

const RULES = [
  { fall: FALL_ALTBEFUNDE, settings: OLD_FINDING_LISTS, holds: onlyDropsEntries },
  { fall: FALL_KARTE, settings: new Map([[KARTE, WHOLE_FILE]]), holds: onlyTightensMap },
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

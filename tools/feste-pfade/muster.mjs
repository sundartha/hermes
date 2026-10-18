import { imBereich } from "../auftrag/format.mjs";
import { CHECKED_ROOTS, TYPESCRIPT_FILE } from "../ts-dateien.mjs";

const GLOB_TOKEN = /(?<![^/])\*\*\/|\/\*\*$|\*|\?|\{([^{}]*)\}/g;
const EXTENSION_BRACE = /\.\{[^{}]*\}$/;
const BRACE = /\{([^{}]*)\}/;
const BRACES = /[{}]/g;
const INNER_GROUP = /(?<!\\)\((\?(?::|=|!|<=|<!|<\w+>))?([^()]*)\)([?*]|\{0)?/g;
const PLAIN_GROUP = new Set([undefined, "?:"]);
const EXTENSION_GROUP_PREFIX = "\\.";
const END_OF_SOURCE = new Set(["", "$"]);
export const WILDCARD = /[*?[{]/;
const TYPESCRIPT_TAIL = /^\*(?:\.d)?\.(\{[a-z,]+\}|[a-z]+)$/i;
const ANY_FOLDERS = "**";
const SEPARATOR = "/";
const CHOICE = ",";
const BAR = "|";
const ROOT_ANCHOR = /^\//;
const ALL_BELOW = "/**";
const NOT_SPLITTABLE = "lässt sich nicht jede Alternative einzeln prüfen";

function span(from, to) {
  const positions = [];
  for (let position = from; position <= to; position += 1) positions.push(position);
  return positions;
}

function segmentEnd(text, at) {
  const separator = text.indexOf(SEPARATOR, at);
  return separator === -1 ? text.length : separator;
}

function afterSeparators(text, at) {
  return span(at, text.length - 1)
    .filter((index) => text[index] === SEPARATOR)
    .map((index) => index + 1);
}

const WILDCARD_REACH = {
  "**/": (text, at) => [at, ...afterSeparators(text, at)],
  "/**": (text, at) => (text[at] === SEPARATOR ? [text.length] : []),
  "*": (text, at) => span(at, segmentEnd(text, at)),
  "?": (text, at) => (at < text.length && text[at] !== SEPARATOR ? [at + 1] : []),
};

function literalReach(literal) {
  return (text, at) => (text.startsWith(literal, at) ? [at + literal.length] : []);
}

function choiceReach(choices) {
  return (text, at) =>
    choices.filter((choice) => text.startsWith(choice, at)).map((choice) => at + choice.length);
}

function globSteps(pattern) {
  const steps = [];
  let end = 0;
  for (const match of pattern.matchAll(GLOB_TOKEN)) {
    const [token, choices] = match;
    steps.push(
      literalReach(pattern.slice(end, match.index)),
      choices === undefined ? WILDCARD_REACH[token] : choiceReach(choices.split(CHOICE)),
    );
    end = match.index + token.length;
  }
  return [...steps, literalReach(pattern.slice(end))];
}

function matchesSteps(steps, text, at) {
  if (steps.length === 0) return at === text.length;
  const [step, ...rest] = steps;
  return step(text, at).some((next) => matchesSteps(rest, text, next));
}

export function braceAlternatives(pattern) {
  const extension = EXTENSION_BRACE.exec(pattern)?.[0] ?? "";
  const head = pattern.slice(0, pattern.length - extension.length);
  const brace = BRACE.exec(head);
  if (brace === null) return [pattern];
  const before = head.slice(0, brace.index);
  const after = head.slice(brace.index + brace[0].length);
  return brace[1]
    .split(CHOICE)
    .flatMap((choice) => braceAlternatives(`${before}${choice}${after}${extension}`));
}

function typescriptOnly(tail) {
  const ending = TYPESCRIPT_TAIL.exec(tail)?.[1];
  const endings = ending === undefined ? [] : ending.replace(BRACES, "").split(CHOICE);
  return endings.length > 0 && endings.every((ending) => TYPESCRIPT_FILE.test(`.${ending}`));
}

function typescriptFolder(pattern) {
  const segments = pattern.split(SEPARATOR);
  const first = segments.findIndex((segment) => WILDCARD.test(segment));
  const folder = `${segments.slice(0, first).join(SEPARATOR)}${SEPARATOR}`;
  const middle = segments.slice(first, -1).every((segment) => segment === ANY_FOLDERS);
  const fits =
    first > 0 && middle && typescriptOnly(segments.at(-1)) && CHECKED_ROOTS.includes(folder);
  return fits ? folder : undefined;
}

export function hasFileBelow(files, folder) {
  const prefix = folder.endsWith(SEPARATOR) ? folder : `${folder}${SEPARATOR}`;
  return folder !== "" && files.some((file) => file.startsWith(prefix));
}

export function pathExists(files, path) {
  return files.some((file) => imBereich(path, file));
}

function globHits(files, pattern) {
  const folder = typescriptFolder(pattern);
  if (folder !== undefined) return hasFileBelow(files, folder);
  const steps = globSteps(pattern);
  return files.some((file) => matchesSteps(steps, file, 0));
}

export function missingGlobAlternatives(files, pattern, { folderToo = false } = {}) {
  const hits = (alternative) =>
    globHits(files, alternative) || (folderToo && globHits(files, `${alternative}${ALL_BELOW}`));
  return braceAlternatives(pattern).filter((alternative) => !hits(alternative));
}

export function gitignoreGlob(pattern) {
  const anchored = ROOT_ANCHOR.test(pattern) || pattern.slice(0, -1).includes(SEPARATOR);
  const body = pattern.replace(ROOT_ANCHOR, "");
  const placed = anchored ? body : `**/${body}`;
  return placed.endsWith(SEPARATOR) ? `${placed}**` : placed;
}

function regexHits(files, source) {
  const regex = new RegExp(source);
  return files.some((file) => regex.test(file));
}

function isExtensionGroup(source, match) {
  const before = source.slice(match.index - EXTENSION_GROUP_PREFIX.length, match.index);
  const after = source.slice(match.index + match[0].length);
  return before === EXTENSION_GROUP_PREFIX && END_OF_SOURCE.has(after);
}

function groupAlternatives(source, match) {
  const [whole, , body] = match;
  const choices = body.split(BAR);
  if (choices.length === 1 || isExtensionGroup(source, match)) return [];
  const before = source.slice(0, match.index);
  const after = source.slice(match.index + whole.length);
  return choices.map((choice) => ({ choice, source: `${before}(?:${choice})${after}` }));
}

function splittable(source) {
  const groups = [...source.matchAll(INNER_GROUP)].filter(([, , body]) => body.includes(BAR));
  const plain = groups.every(
    ([, prefix, , quantifier]) => PLAIN_GROUP.has(prefix) && quantifier === undefined,
  );
  return plain && !source.replace(INNER_GROUP, "").includes(BAR);
}

export function regexFindings(files, source) {
  if (!splittable(source)) return [`${source} ${NOT_SPLITTABLE}`];
  if (!regexHits(files, source)) return [`${source} trifft keine versionierte Datei`];
  const alternatives = [...source.matchAll(INNER_GROUP)].flatMap((match) =>
    groupAlternatives(source, match),
  );
  return alternatives
    .filter((alternative) => !regexHits(files, alternative.source))
    .map(({ choice }) => `${source}: die Alternative ${choice} trifft keine versionierte Datei`);
}

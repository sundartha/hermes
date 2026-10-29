import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { erlaubteNamen, KARTE, karteAus } from "./abhaengigkeiten/bausteine.mjs";

export const GENERATE_COMMAND = "npm run hinweise";
export const FOLDER_INSTRUCTIONS = "CLAUDE.md";
const HEADING_PREFIX = "## Baustein ";
const PURPOSE_PREFIX = "- Zweck: ";
const SHARED_PREFIX = "- Zweck und Darf nutzen: ";
const ALLOWED_PREFIX = "- Darf nutzen: ";
const PLACE_PREFIX = "- Ort für Neues: ";
const ENTRANCE_PREFIX = "- Eingang: ";
const STRANGERS_PREFIX = "- Andere Bausteine in diesem Ordner: ";
const BLOCK_LINE_PREFIXES = [
  PURPOSE_PREFIX,
  SHARED_PREFIX,
  ALLOWED_PREFIX,
  PLACE_PREFIX,
  ENTRANCE_PREFIX,
  STRANGERS_PREFIX,
];
const LINE_BREAK = "\n";
const LIST_SEPARATOR = ", ";
const GROUP_SEPARATOR = "; ";

function relativeNames(files, folder) {
  return files.filter((path) => path.startsWith(folder)).map((path) => path.slice(folder.length));
}

function entranceText(entry, folder) {
  if (entry.eingaenge === "alle")
    return `Jede Datei in \`${folder}\` darf von anderen Bausteinen importiert werden.`;
  const names = relativeNames([...entry.eingaenge].toSorted(), folder);
  if (names.length === 0) return `Kein Eingang liegt in \`${folder}\`.`;
  return `Andere Bausteine importieren aus \`${folder}\` nur ${names.join(LIST_SEPARATOR)}.`;
}

function placeText(entry, folder) {
  const rule = `Neue Dateien in \`${folder}\` gehören zu ${entry.baustein}, solange ${KARTE} sie keinem anderen Baustein nennt.`;
  const others = entry.ordner.filter((ordner) => ordner !== folder);
  if (others.length === 0) return rule;
  return `${rule} Weitere Ordner von ${entry.baustein}: ${others.map((ordner) => `\`${ordner}\``).join(LIST_SEPARATOR)}.`;
}

function strangerGroup(other, folder) {
  const files = relativeNames([...other.dateien].toSorted(), folder);
  return files.length > 0 ? `${other.baustein} (${files.join(LIST_SEPARATOR)})` : "";
}

function strangersText(map, entry, folder) {
  const groups = map.bausteine
    .filter((other) => other !== entry)
    .map((other) => strangerGroup(other, folder));
  return groups.filter((group) => group !== "").join(GROUP_SEPARATOR);
}

function sharedLines(map, entry, folder) {
  const [first] = entry.ordner;
  if (folder === first)
    return [`${PURPOSE_PREFIX}${entry.zweck}`, `${ALLOWED_PREFIX}${erlaubteNamen(map, entry)}`];
  return [
    `${SHARED_PREFIX}stehen in \`${first}${FOLDER_INSTRUCTIONS}\`, dem ersten Ordner von ${entry.baustein}.`,
  ];
}

function blockLines(map, entry, folder) {
  const strangers = strangersText(map, entry, folder);
  return [
    `${HEADING_PREFIX}${entry.baustein} (erzeugt aus ${KARTE} mit ${GENERATE_COMMAND})`,
    ...sharedLines(map, entry, folder),
    `${PLACE_PREFIX}${placeText(entry, folder)}`,
    `${ENTRANCE_PREFIX}${entranceText(entry, folder)}`,
    ...(strangers === "" ? [] : [`${STRANGERS_PREFIX}${strangers}`]),
  ];
}

export function expectedBlocks(root) {
  const path = join(root, KARTE);
  if (!existsSync(path)) return new Map();
  const map = karteAus(JSON.parse(readFileSync(path, "utf8")));
  const blocks = map.bausteine.flatMap((entry) => {
    const present = {
      ...entry,
      ordner: entry.ordner.filter((folder) => existsSync(join(root, folder))),
    };
    return present.ordner.map((folder) => [folder, blockLines(map, present, folder)]);
  });
  return new Map(blocks);
}

export function splitLines(text) {
  return text.split(LINE_BREAK);
}

function lineKind(line = "") {
  return BLOCK_LINE_PREFIXES.find((prefix) => line.startsWith(prefix));
}

export function findBlock(lines, expected) {
  const start = lines.findIndex((line) => line.startsWith(HEADING_PREFIX));
  if (start === -1) return undefined;
  let end = start + 1;
  while (
    end - start < expected.length &&
    lineKind(lines[end]) === lineKind(expected[end - start])
  ) {
    end += 1;
  }
  return { start, end };
}

export function blockMatches(lines, expected) {
  const found = findBlock(lines, expected);
  if (found === undefined) return false;
  const actual = lines.slice(found.start, found.end).map((line) => line.trimEnd());
  return (
    actual.length === expected.length && actual.every((line, index) => line === expected[index])
  );
}

function karteFinding(path, folder, text) {
  return { key: [path, "kartenteil"].join("|"), location: `${path} ${text}`, always: true, folder };
}

export function blockFindings(root, blocks) {
  return [...blocks].flatMap(([folder, expected]) => {
    const path = `${folder}${FOLDER_INSTRUCTIONS}`;
    if (!existsSync(join(root, path))) {
      return [
        karteFinding(
          path,
          folder,
          `fehlt; ${KARTE} nennt ${folder} als Ordner eines Bausteins, ${GENERATE_COMMAND} legt sie an`,
        ),
      ];
    }
    const lines = splitLines(readFileSync(join(root, path), "utf8"));
    if (blockMatches(lines, expected)) return [];
    const text =
      findBlock(lines, expected) === undefined
        ? `hat keinen Kartenteil; ${GENERATE_COMMAND} erzeugt ihn aus ${KARTE}`
        : `hat einen Kartenteil, der nicht zu ${KARTE} passt; ${GENERATE_COMMAND} erzeugt ihn neu`;
    return [karteFinding(path, folder, text)];
  });
}

export function coveredLines(root, blocks) {
  const covered = new Set();
  for (const [folder, expected] of blocks) {
    const path = `${folder}${FOLDER_INSTRUCTIONS}`;
    if (!existsSync(join(root, path))) continue;
    const lines = splitLines(readFileSync(join(root, path), "utf8"));
    if (!blockMatches(lines, expected)) continue;
    const { start, end } = findBlock(lines, expected);
    for (let index = start; index < end; index += 1) {
      if (!lines[index].startsWith(PURPOSE_PREFIX)) covered.add(`${path}:${index + 1}`);
    }
  }
  return covered;
}

export function withBlock(text, expected) {
  const lines = splitLines(text);
  const found = findBlock(lines, expected);
  if (found !== undefined)
    return [...lines.slice(0, found.start), ...expected, ...lines.slice(found.end)].join(
      LINE_BREAK,
    );
  const body = text.trimEnd();
  return body === ""
    ? `${expected.join(LINE_BREAK)}${LINE_BREAK}`
    : `${body}${LINE_BREAK}${LINE_BREAK}${expected.join(LINE_BREAK)}${LINE_BREAK}`;
}

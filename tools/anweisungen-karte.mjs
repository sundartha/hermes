import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { erlaubteNamen, javascriptPfad, KARTE, karteAus } from "./bausteine.mjs";

export const GENERATE_COMMAND = "npm run hinweise";
export const FOLDER_INSTRUCTIONS = "CLAUDE.md";
const HEADING_PREFIX = "## Baustein ";
const FILES_HEADING_PREFIX = "## Bausteine in diesem Ordner ";
const FILES_LINE_PREFIX = "- ";
const ROUTES_FOLDER = "src/routes/";
const PURPOSE_PREFIX = "- Zweck: ";
const SHARED_PREFIX = "- Zweck und Darf nutzen: ";
const ALLOWED_PREFIX = "- Darf nutzen: ";
const PLACE_PREFIX = "- Ort für Neues: ";
const ENTRANCE_PREFIX = "- Eingang: ";
const STRANGERS_PREFIX = "- Andere Bausteine in diesem Ordner: ";
const BLOCK_LINE_ORDER = [
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

function directFiles(entry, folder) {
  return [...entry.dateien].filter((path) => `${dirname(path)}/` === folder).toSorted();
}

function filesFolders(map) {
  const sources = map.bausteine.flatMap((entry) => entry.ordner);
  const folders = map.bausteine.flatMap((entry) => [...entry.dateien].map((path) => `${dirname(path)}/`));
  return [...new Set(folders)].filter((folder) => !sources.some((source) => folder.startsWith(source)));
}

function realNames(entry, files, folder) {
  const real = files.map((path) => entry.quellen.find((quelle) => javascriptPfad(quelle) === path));
  return relativeNames(real, folder);
}

function filesEntrance(entry, files, folder) {
  if (entry.eingaenge === "alle") return "Jede Datei hier ist Eingang.";
  const names = realNames(entry, files.filter((path) => entry.eingaenge.has(path)), folder);
  return names.length > 0 ? `Eingang: ${names.join(LIST_SEPARATOR)}.` : "Eingang: kein Eingang hier.";
}

function filesShared(map, entry) {
  if (entry.ordner.length === 0)
    return `Zweck: ${entry.zweck} Darf nutzen: ${erlaubteNamen(map, entry)}.`;
  return `Zweck und Darf nutzen: stehen in \`${entry.ordner[0]}${FOLDER_INSTRUCTIONS}\`, dem ersten Ordner von ${entry.baustein}.`;
}

function filesPlace(folder) {
  if (folder === ROUTES_FOLDER)
    return `Neue Route mit \`npm run neu -- route <baustein> <name>\`; der Baustein steht in ${KARTE}.`;
  return `Neue Dateien direkt in \`${folder}\` nur, wenn ${KARTE} sie einem Baustein nennt, sonst ist die Architektur rot.`;
}

function filesRow(map, { entry, files }, folder) {
  const names = realNames(entry, files, folder).join(LIST_SEPARATOR);
  return `${FILES_LINE_PREFIX}${entry.baustein}: ${names}. ${filesShared(map, entry)} ${filesEntrance(entry, files, folder)}`;
}

function filesLines(map, folder) {
  const owners = map.bausteine.map((entry) => ({ entry, files: directFiles(entry, folder) }));
  const rows = owners.filter(({ files }) => files.length > 0).map((owner) => filesRow(map, owner, folder));
  return [
    `${FILES_HEADING_PREFIX}(erzeugt aus ${KARTE} mit ${GENERATE_COMMAND})`,
    ...rows,
    `${PLACE_PREFIX}${filesPlace(folder)}`,
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
  const folders = filesFolders(map)
    .filter((folder) => existsSync(join(root, folder)))
    .map((folder) => [folder, filesLines(map, folder)]);
  return new Map([...blocks, ...folders]);
}

export function splitLines(text) {
  return text.split(LINE_BREAK);
}

function lineRank(line = "") {
  return BLOCK_LINE_ORDER.findIndex((prefix) => line.startsWith(prefix));
}

function findFilesBlock(lines) {
  const start = lines.findIndex((line) => line.startsWith(FILES_HEADING_PREFIX));
  if (start === -1) return undefined;
  let end = start + 1;
  while (lines[end]?.startsWith(FILES_LINE_PREFIX)) end += 1;
  return { start, end };
}

export function findBlock(lines) {
  const files = findFilesBlock(lines);
  if (files !== undefined) return files;
  const start = lines.findIndex((line) => line.startsWith(HEADING_PREFIX));
  if (start === -1) return undefined;
  let end = start + 1;
  let rank = -1;
  while (lineRank(lines[end]) > rank) {
    rank = lineRank(lines[end]);
    end += 1;
  }
  return { start, end };
}

export function withBlock(text, expected) {
  const lines = splitLines(text);
  const found = findBlock(lines);
  if (found !== undefined)
    return [...lines.slice(0, found.start), ...expected, ...lines.slice(found.end)].join(
      LINE_BREAK,
    );
  const body = text.trimEnd();
  return body === ""
    ? `${expected.join(LINE_BREAK)}${LINE_BREAK}`
    : `${body}${LINE_BREAK}${LINE_BREAK}${expected.join(LINE_BREAK)}${LINE_BREAK}`;
}

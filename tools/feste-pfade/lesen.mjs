import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SEPARATOR = "/";
const ANCHOR = "#";
const MANIFEST = "pruefung.json";
const JSON_ENDING = ".json";
const WHITESPACE = /\s/;
const PERMISSION = /^(Edit|MultiEdit|Write|NotebookEdit|Read)\((.+)\)$/;
const OUTSIDE_REPOSITORY = /^(?:\/\/|~)/;
const CURRENT_FOLDER = /^\.\//;
const NOT_EXPORTED =
  "wird dort nicht exportiert; die Prüfung fester Pfade liest die Liste über den Export";
export const READ = "Read";
export const ALLOWED_UNCHECKED =
  "allowed: die Prüfung fester Pfade prüft allowed-Regeln nicht; eine Erlaubnisliste trifft eine umbenannte Datei still nicht mehr";

export function readJson(state, path) {
  return JSON.parse(readFileSync(join(state.root, path), "utf8"));
}

export function moduleOf(state, file) {
  return import(pathToFileURL(resolve(state.root, file)).href);
}

export function exportedValue(module, file, name) {
  return module[name] === undefined
    ? { finding: `${file}: ${name} ${NOT_EXPORTED}` }
    : { value: module[name] };
}

export function stringsIn(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

export function codeownersEntries(state, file) {
  const lines = readFileSync(join(state.root, file), "utf8")
    .split("\n")
    .map((line) => line.trim());
  return lines
    .filter((line) => line !== "" && !line.startsWith(ANCHOR))
    .map((line) => {
      const [pattern, ...owners] = line.split(WHITESPACE).filter(Boolean);
      return { pattern, owners };
    });
}

export function permissionTarget(rule) {
  const [, tool, target] = PERMISSION.exec(rule) ?? [];
  if (target === undefined || OUTSIDE_REPOSITORY.test(target)) return undefined;
  return { tool, pattern: target.replace(CURRENT_FOLDER, "") };
}

export function roleFiles(state, folder) {
  return state.files.filter((path) => path.startsWith(folder) && path.endsWith(JSON_ENDING));
}

export function manifestFiles(state, folder) {
  const manifests = readdirSync(join(state.root, folder)).map(
    (id) => `${folder}${id}${SEPARATOR}${MANIFEST}`,
  );
  return manifests.filter((manifest) => state.files.includes(manifest));
}

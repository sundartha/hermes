import { existsSync, readFileSync } from "node:fs";

import { TOOL_TEST_DIRECTORY } from "../../test/testbaenke-run.mjs";

export const LIST_FILE = "tools/basis/werkzeugtests-mit-produkt.json";
const HARNESS_FILES = ["test/testbaenke-run.mjs", "test/i18n-catalog-run.mjs", "test/package.json"];
export const HIDDEN_DIRECTORIES = ["src/", "plaene/"];
const TEST_DIRECTORY = "test/";

export function isToolTreePath(path) {
  if (HIDDEN_DIRECTORIES.some((prefix) => path.startsWith(prefix))) return false;
  if (!path.startsWith(TEST_DIRECTORY)) return true;
  return path.startsWith(TOOL_TEST_DIRECTORY) || HARNESS_FILES.includes(path);
}

function isReason(value) {
  return typeof value === "string" && value.trim() !== "";
}

function entriesOf(text) {
  const parsed = JSON.parse(text);
  const isMap = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  if (!isMap || !Object.values(parsed).every(isReason)) {
    throw new Error("erwartet ein Objekt aus Testdatei und Grund in einem Satz");
  }
  return Object.keys(parsed).sort();
}

export function readList(file = LIST_FILE) {
  if (!existsSync(file)) return { dateien: [], fehler: `${file} fehlt` };
  try {
    return { dateien: entriesOf(readFileSync(file, "utf8")), fehler: null };
  } catch (error) {
    return { dateien: [], fehler: `${file} unlesbar: ${error.message}` };
  }
}

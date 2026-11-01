import { existsSync, globSync, readFileSync } from "node:fs";

import { TOOL_TEST_DIRECTORY, TOOL_TEST_GLOB } from "../../test/testbaenke-run.mjs";
import { changedFiles } from "../betroffene-tests.mjs";

export const LIST_FILE = "tools/basis/werkzeugtests-mit-produkt.json";
export const HARNESS_FILES = ["test/testbaenke-run.mjs", "test/i18n-catalog-run.mjs", "test/package.json"];
const PRODUCT_PREFIXES = ["src/", "test/"];
const DELETED = "D";
const ALL = Object.freeze({ art: "alle" });

function isProductChange({ status, path }) {
  const isProductPath = PRODUCT_PREFIXES.some((prefix) => path.startsWith(prefix));
  return status !== DELETED && isProductPath && !path.startsWith(TOOL_TEST_DIRECTORY);
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

function readList(file = LIST_FILE) {
  if (!existsSync(file)) return { dateien: [], fehler: `${file} fehlt` };
  try {
    return { dateien: entriesOf(readFileSync(file, "utf8")), fehler: null };
  } catch (error) {
    return { dateien: [], fehler: `${file} unlesbar: ${error.message}` };
  }
}

function isPureProductChange(changes) {
  if (changes === null) return false;
  const touchesHarness = changes.some(({ path }) => HARNESS_FILES.includes(path));
  return !touchesHarness && changes.every(isProductChange);
}

function listSelection({ list, toolTestFiles }) {
  const known = new Set(toolTestFiles);
  if (list.fehler !== null || !list.dateien.every((file) => known.has(file))) return ALL;
  return { art: "liste", dateien: list.dateien };
}

function selectToolTests({ changes, list, toolTestFiles }) {
  const pureProduct = isPureProductChange(changes);
  const selection = pureProduct ? listSelection({ list, toolTestFiles }) : ALL;
  return { ...selection, reinProdukt: pureProduct, liste: list.dateien, listenfehler: list.fehler };
}

export async function planToolTests(baseRef) {
  return selectToolTests({
    changes: await changedFiles(baseRef),
    list: readList(),
    toolTestFiles: globSync(TOOL_TEST_GLOB),
  });
}

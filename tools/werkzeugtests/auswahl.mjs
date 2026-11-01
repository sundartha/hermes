import { globSync } from "node:fs";

import { TOOL_TEST_GLOB } from "../../test/testbaenke-run.mjs";
import { changedFiles } from "../betroffene-tests.mjs";
import { isToolTreePath, readList } from "./werkzeugbaum.mjs";

const DELETED = "D";
const ALL = Object.freeze({ art: "alle" });

function isProductChange({ status, path }) {
  return status !== DELETED && !isToolTreePath(path);
}

function isPureProductChange(changes) {
  return changes !== null && changes.every(isProductChange);
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

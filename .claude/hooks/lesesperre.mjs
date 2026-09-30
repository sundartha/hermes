import { readFileSync } from "node:fs";
import { extname } from "node:path";

import { block, readInput } from "./lib.mjs";

const MAX_UNBOUNDED_LINES = 1000;
const NEWLINE = 10;
const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".ipynb"]);

function lineCount(path) {
  try {
    return readFileSync(path).filter((byte) => byte === NEWLINE).length + 1;
  } catch {
    return 0;
  }
}

function isBounded({ offset, limit }) {
  return offset !== undefined || limit !== undefined;
}

function main() {
  const { file_path: path, ...range } = readInput().tool_input ?? {};
  if (typeof path !== "string" || isBounded(range)) return;
  if (BINARY_EXTENSIONS.has(extname(path).toLowerCase())) return;
  const lines = lineCount(path);
  if (lines <= MAX_UNBOUNDED_LINES) return;
  block([
    `${path} hat ${lines} Zeilen und wird nicht vollständig gelesen.`,
    "Suche zuerst mit Grep nach der Stelle und lies dann einen Ausschnitt mit offset und limit.",
  ]);
}

main();

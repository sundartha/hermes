import { existsSync, readFileSync } from "node:fs";

export const LIST_FILE = "tools/basis/werkzeugtests-mit-produkt.json";

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

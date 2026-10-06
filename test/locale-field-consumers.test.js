import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { LOCALES } from "../src/i18n/locales.js";

const SRC_DIR = path.join(ROOT, "src");
const BUNDLE_SOURCE = path.join("i18n", "locales.js");
const MIN_EXPECTED_SOURCE_FILES = 50;
const MIN_EXPECTED_LOCALE_FIELDS = 20;

function productionSources() {
  return fs
    .readdirSync(SRC_DIR, { recursive: true })
    .filter((rel) => rel.endsWith(".js") && rel !== BUNDLE_SOURCE)
    .map((rel) => fs.readFileSync(path.join(SRC_DIR, rel), "utf8"));
}

function consumerCountOf(field, sources) {
  const pattern = new RegExp(`\\.${field}\\b`);
  return sources.filter((text) => pattern.test(text)).length;
}

test("GAP-31 (SOLL, rot) - jedes Feld des Locale-Bundles hat mindestens einen Produktionskonsumenten", () => {
  const sources = productionSources();
  assert.ok(sources.length > MIN_EXPECTED_SOURCE_FILES, "Scan hat nichts gefunden -> Detektor kaputt");
  assert.ok(
    Object.keys(LOCALES.de).length > MIN_EXPECTED_LOCALE_FIELDS,
    "LOCALES.de hat zu wenige Felder -> Detektor kaputt",
  );

  const orphans = Object.keys(LOCALES.de).filter((field) => consumerCountOf(field, sources) === 0);
  assert.deepEqual(orphans, [], `Locale-Felder ohne Konsument: ${orphans.join(", ")}`);
});

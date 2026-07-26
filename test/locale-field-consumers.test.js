// GAP-31 (tasks/i18n-tests/11-luecken-und-e2e.md): jedes Feld des Locale-Bundles hat
// einen Produktionskonsumenten. SOLL - heute rot.
// Konsument = eine ".<feld>"-Referenz irgendwo in src/**/*.js AUSSERHALB der
// definierenden Datei src/i18n/locales.js. Bewusst NICHT "ausserhalb src/i18n/":
// greetingDefault/greetingVariants werden von src/i18n/greeting-catalog.js gelesen,
// das seinerseits von src/self-service-routes.js konsumiert wird - die engere Regel
// haette diese seit P15 geschlossene ID falsch als Befund gemeldet (19-w2-baseline 2.7).
// Gegen die DE-Fassung gemessen: LOCALES.de fuehrt die vollstaendige Feldmenge.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { LOCALES } from "../src/i18n/locales.js";

const SRC_DIR = path.join(ROOT, "src");
const BUNDLE_SOURCE = path.join("i18n", "locales.js"); // definierende Datei, kein Konsument
const MIN_EXPECTED_SOURCE_FILES = 50; // Selbstschutz: Scan hat sonst nichts gefunden
const MIN_EXPECTED_LOCALE_FIELDS = 20; // Selbstschutz: LOCALES.de ist sonst leer/kaputt

// Alle .js-Dateien unter src/, ausser der definierenden Bundle-Datei selbst.
function productionSources() {
  return fs
    .readdirSync(SRC_DIR, { recursive: true })
    .filter((rel) => rel.endsWith(".js") && rel !== BUNDLE_SOURCE)
    .map((rel) => fs.readFileSync(path.join(SRC_DIR, rel), "utf8"));
}

// Anzahl Dateien, die IRGENDWO ".<field>" referenzieren (Property-Zugriff, kein
// Deklarations-Kontext noetig - jede Lese-Stelle im Produktionscode zaehlt als Konsument).
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

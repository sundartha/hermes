// GAP-15 (i18n-Testkatalog, tasks/i18n-tests/11-luecken-und-e2e.md:419) - Kein Build mit
// Platzhalter-Rechtstexten, EN-Routen vorhanden.
//
// SOLL (rot): 0 Platzhalter-Treffer in /agb, /datenschutz, /impressum UND EN-Routen
// (z.B. /legal/privacy, /legal/terms) vorhanden. Heute bezeichnen sich alle drei
// Rechtsseiten selbst als Platzhalter (apps/web/src/pages/{agb,datenschutz,impressum}.astro)
// und apps/web/src/pages enthaelt keine einzige EN-Rechtsroute.
//
// Reine Quelltext-Pruefung (kein Astro-Build noetig, Vorgabe des Katalogs: "Routen-Paritaet
// braucht keinen Build"). Liest NUR apps/web/, aendert nichts (Regel 1: nur test/).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const PAGES_DIR = path.join(ROOT, "apps/web/src/pages");
const LEGAL_PAGES = ["agb.astro", "datenschutz.astro", "impressum.astro"];
// Signalwoerter, mit denen sich die Seiten selbst als Platzhalter bezeichnen (Beleg
// tasks/i18n-tests/11-luecken-und-e2e.md:432-433: "Platzhalter", "ergaenzt der finale",
// "liefert der Owner").
const PLACEHOLDER_MARKERS = /Platzhalter|ergaenzt der finale|liefert der Owner|liefert Sundartha/;

test("GAP-15 (SOLL rot): 0 Platzhalter-Treffer in agb/datenschutz/impressum", () => {
  const hits = [];
  for (const file of LEGAL_PAGES) {
    const content = fs.readFileSync(path.join(PAGES_DIR, file), "utf8");
    if (PLACEHOLDER_MARKERS.test(content)) hits.push(file);
  }
  assert.deepEqual(
    hits,
    [],
    `SOLL: keine Rechtsseite darf sich selbst als Platzhalter bezeichnen (Treffer in: ${hits.join(", ")})`,
  );
});

test("GAP-15 (SOLL rot): EN-Rechtsroute (z.B. /legal/privacy oder /legal/terms) existiert", () => {
  const files = fs.readdirSync(PAGES_DIR, { recursive: true });
  const hasLegalDir = files.some((f) => String(f).startsWith("legal" + path.sep) || String(f) === "legal");
  assert.ok(
    hasLegalDir,
    `SOLL: apps/web/src/pages braucht eine EN-Rechtsroute (z.B. legal/privacy.astro) - ` +
      `vorhandene Dateien: ${files.join(", ")}`,
  );
});

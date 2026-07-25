// GAP-15 (i18n-Testkatalog, tasks/i18n-tests/11-luecken-und-e2e.md:419) - Kein Build mit
// Platzhalter-Rechtstexten, EN-Routen vorhanden.
//
// R5-Korrektur (P14): die Mechanik (Content-Quelle src/data/legal/, EN-Route
// src/pages/legal/[slug].astro, noindex) ist seit P14 gebaut - GAP-15 wartet
// jetzt NUR noch auf die Textlieferung (O13-Auflage, nicht Codedefekt). Beide
// Assertionen unten mussten dafuer ihr Messziel wechseln, OHNE die Erwartung zu
// senken (sonst waere GAP-15 hohl gruen geworden, s. PLAN-I18N-FIX Abschnitt 3):
//  - Assertion 1 zielte auf die drei .astro-Seiten - der Text wohnt seit P14 in
//    src/data/legal/*.json, waere also ohne jede Aenderung am Rechtsrisiko
//    gruen geworden. Neues Ziel: alle Sprachfassungen in src/data/legal/ PLUS
//    die Rechtsseiten und die LegalDocument-Komponente (falls Text zurueck ins
//    Markup wandert).
//  - Assertion 2 pruefte "existiert ein legal/-Verzeichnis" - das existiert seit
//    P14 als Datei, liefert aber ausdruecklich 404 ohne Content (O13). Neues
//    Ziel: fuer jeden Slug muss eine <slug>.en.json vorliegen - genau die
//    Bedingung, an der die Route haengt.
//
// Reine Quelltext-Pruefung (kein Astro-Build noetig, Vorgabe des Katalogs: "Routen-Paritaet
// braucht keinen Build"). Liest NUR apps/web/, aendert nichts (Regel 1: nur test/).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { LEGAL_SLUGS } from "../apps/web/src/lib/legal.js";

const PAGES_DIR = path.join(ROOT, "apps/web/src/pages");
const LEGAL_CONTENT_DIR = path.join(ROOT, "apps/web/src/data/legal");
const LEGAL_PAGES = ["agb.astro", "datenschutz.astro", "impressum.astro"];
const LEGAL_DOCUMENT_COMPONENT = path.join(
  ROOT,
  "apps/web/src/components/site/LegalDocument.astro",
);
// Signalwoerter, mit denen sich Rechtstexte selbst als Platzhalter bezeichnen (Beleg
// tasks/i18n-tests/11-luecken-und-e2e.md:432-433: "Platzhalter", "ergaenzt der finale",
// "liefert der Owner").
const PLACEHOLDER_MARKERS = /Platzhalter|ergaenzt der finale|liefert der Owner|liefert Sundartha/;

function placeholderHitsIn(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return PLACEHOLDER_MARKERS.test(content);
}

test("GAP-15 (SOLL rot): 0 Platzhalter-Treffer im gesamten Rechtstext-Content", () => {
  const contentFiles = fs
    .readdirSync(LEGAL_CONTENT_DIR)
    .map((file) => path.join(LEGAL_CONTENT_DIR, file));
  const pageFiles = LEGAL_PAGES.map((file) => path.join(PAGES_DIR, file));
  const candidates = [...contentFiles, ...pageFiles, LEGAL_DOCUMENT_COMPONENT];

  const hits = candidates.filter(placeholderHitsIn).map((f) => path.relative(ROOT, f));
  assert.deepEqual(
    hits,
    [],
    `SOLL: keine Rechtsseite darf sich selbst als Platzhalter bezeichnen (Treffer in: ${hits.join(", ")})`,
  );
});

test("GAP-15 (SOLL rot): EN-Fassung liegt fuer jeden Rechts-Slug vor", () => {
  const missing = LEGAL_SLUGS.filter(
    (slug) => !fs.existsSync(path.join(LEGAL_CONTENT_DIR, `${slug}.en.json`)),
  );
  assert.deepEqual(
    missing,
    [],
    `SOLL: EN-Fassung fehlt: ${missing.join(", ")}`,
  );
});

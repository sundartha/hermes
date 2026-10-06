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

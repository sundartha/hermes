// Rechts-Blatt der Startseite: alle Ziele des Handy-Fussbands stehen auch als
// Reiter im Blatt (components/LegalTabs.astro, Owner-Wunsch 2026-09-27). Rein,
// ohne astro-Build: geprueft wird die Quelle beider Stellen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(WEB_ROOT, path), "utf8");
const tabs = read("src/components/LegalTabs.astro");
const footer = read("src/components/MobileHome.astro");
const index = read("src/pages/index.astro");

// Die Ziele des Fussbands, wie MobileHome sie verlinkt.
const FOOTER_TARGETS = [
  {
    name: "Rechtstexte je Dokument",
    footer: "data-legal-open={entry.slug}",
    tabs: "data-legal-pill={entry.slug}",
  },
  {
    name: "Vertraege kuendigen",
    footer: 'href="/kuendigen">Verträge kündigen<',
    tabs: 'href="/kuendigen">Verträge kündigen<',
  },
  { name: "Kontakt", footer: "href={`mailto:${contact}`}", tabs: "href={`mailto:${contact}`}" },
  { name: "Cookie-Einstellungen", footer: "data-consent-open", tabs: "data-consent-open" },
];

test("Rechts-Blatt: jedes Ziel des Fussbands steht auch als Reiter im Blatt", () => {
  for (const target of FOOTER_TARGETS) {
    assert.ok(
      footer.includes(target.footer),
      `Fussband: ${target.name} nicht gefunden (Test veraltet?)`,
    );
    assert.ok(tabs.includes(target.tabs), `Rechts-Blatt: ${target.name} fehlt`);
  }
});

test("Rechts-Blatt: die Startseite bindet die Reiter ein, die alten Pillen sind weg", () => {
  assert.match(index, /<LegalTabs legalDocs=\{legalDocs\} contact=\{CONTACT\} \/>/);
  assert.ok(!index.includes('class="legal-pills"'), "alte 2x2-Pillen noch im Blatt");
  assert.ok(!read("src/styles/hermes.css").includes(".legal-pills"), "totes CSS fuer .legal-pills");
});

test("Rechts-Blatt: der Segment-Daumen folgt dem aktiven Reiter (2. und 3. Position)", () => {
  const css = read("src/styles/hermes.css");
  assert.match(
    css,
    /\.legal-seg:has\(> \.legal-pill:nth-of-type\(2\)\[aria-current="page"\]\) \.legal-seg__thumb/,
  );
  assert.match(
    css,
    /\.legal-seg:has\(> \.legal-pill:nth-of-type\(3\)\[aria-current="page"\]\) \.legal-seg__thumb/,
  );
});

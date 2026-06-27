// W1-Tests: der GEBAUTE Output der oeffentlichen Unterseiten. Astro pruned
// ungenutztes CSS nicht, daher ist nur das echte Build-Ergebnis die Wahrheit
// fuer "kein Markenrot im Output" und "alle Seiten teilen das Site-Chrome".
//
// Build-Operate-Check (P13): ein einmaliger astro-build in einen eigenen
// Test-outDir (before), danach reine Asserts gegen die erzeugten HTML/CSS-
// Dateien. Self-validating, repeatable (offline, lokale Fonts), kein DOM.
//
// SCOPE: geprueft werden die oeffentlichen Unterseiten — NICHT der eingeloggte
// App-Bereich (/app), der das Markenrot bewusst weiter nutzt (W1 Out-of-Scope).
// Daher wird das Markenrot je Seite NUR in den von DIESER Seite verlinkten CSS-
// Bundles gesucht (nicht pauschal ueber ganz dist/).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST_DIR = join(WEB_ROOT, "dist-test");

// Markenrot darf im gerenderten Output der Unterseiten NICHT auftauchen.
const BRAND_RED = "#e60000";

// Beleg, dass eine Seite das geteilte Site-Chrome nutzt (Hero-Marke + Logo).
const SITE_CHROME_MARKERS = ["by Sundartha", "sandal_solid.png"];

const MARKETING_PAGES = [
  "so-funktionierts/index.html",
  "preise/index.html",
  "registrieren/index.html",
  "404.html",
];
const LEGAL_PAGES = [
  "impressum/index.html",
  "datenschutz/index.html",
  "agb/index.html",
];

function readDist(relativePath) {
  return readFileSync(join(DIST_DIR, relativePath), "utf8");
}

// Liest alle von einer Seite verlinkten lokalen CSS-Dateien (href="/...css").
function linkedStylesheets(html) {
  const hrefs = [...html.matchAll(/<link[^>]+href="(\/[^"]+\.css)"/g)].map(
    (match) => match[1],
  );
  return hrefs.map((href) => readDist(href.replace(/^\//, "")));
}

before(() => {
  rmSync(DIST_DIR, { recursive: true, force: true });
  // Eigener outDir, damit der Test den regulaeren dist/-Output nicht beruehrt.
  execFileSync("npx", ["astro", "build", "--outDir", DIST_DIR], {
    cwd: WEB_ROOT,
    stdio: "pipe",
  });
});

test("kein Markenrot (#e60000) im Output der Unterseiten (HTML + verlinkte CSS)", () => {
  for (const page of [...MARKETING_PAGES, ...LEGAL_PAGES]) {
    const html = readDist(page);
    const blobs = [html, ...linkedStylesheets(html)];
    for (const blob of blobs) {
      assert.ok(
        !blob.toLowerCase().includes(BRAND_RED),
        `${page} rendert Markenrot ${BRAND_RED}`,
      );
    }
  }
});

test("jede Unterseite nutzt das geteilte Site-Chrome", () => {
  for (const page of [...MARKETING_PAGES, ...LEGAL_PAGES]) {
    const html = readDist(page);
    for (const marker of SITE_CHROME_MARKERS) {
      assert.ok(html.includes(marker), `${page} fehlt Chrome-Marker "${marker}"`);
    }
  }
});

test("Marketing-Seiten sind englisch (lang=en), Legal-Seiten deutsch (lang=de)", () => {
  for (const page of MARKETING_PAGES) {
    assert.match(readDist(page), /<html lang="en"/, `${page} sollte lang=en sein`);
  }
  for (const page of LEGAL_PAGES) {
    assert.match(readDist(page), /<html lang="de"/, `${page} sollte lang=de sein`);
  }
});

test("Pricing rendert USD aus dem Katalog (beide Tarife)", () => {
  // BK0/AM3: Preise kommen aus lib/plans.js (Spiegel der Backend-SSoT), jetzt USD.
  // Das gebaute preise/index.html rendert nun "$4.99"/"$9.99" (currency: usd).
  const html = readDist("preise/index.html");
  assert.ok(html.includes("$4.99") && html.includes("$9.99"), "USD-Katalog-Preise fehlen");
  assert.ok(html.includes("Starter") && html.includes("Business"), "Tarifnamen fehlen");
});

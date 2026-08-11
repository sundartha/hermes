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
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { LEGAL_SLUGS, LEGAL_TRANSLATION_NOTICE } from "../src/lib/legal.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST_DIR = join(WEB_ROOT, "dist-test");
const LEGAL_CONTENT_DIR = join(WEB_ROOT, "src/data/legal");

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

test("Pricing rendert EUR aus dem Katalog (beide Tarife)", () => {
  // BK0/AM3: Preise kommen aus lib/plans.js (Spiegel der Backend-SSoT), seit dem
  // Stripe-Live-Cutover EUR. Das gebaute preise/index.html rendert "€4.99"/"€9.99".
  const html = readDist("preise/index.html");
  assert.ok(html.includes("€4.99") && html.includes("€9.99"), "EUR-Katalog-Preise fehlen");
  assert.ok(html.includes("Starter") && html.includes("Business"), "Tarifnamen fehlen");
});

// P14/GAP-15: der Waechter fuer den Liefertag der englischen Rechtsdokumente.
// Heute leer-quantifiziert (kein *.en.json vorhanden -> keine gebaute EN-Seite,
// beide Mengen leer -> gruen). Sobald der Owner Text liefert, muessen genau die
// gelieferten Slugs gebaut werden und die noindex-/Vorrangklausel-Regel greifen.
test("EN-Rechtsseiten: gebaute Menge entspricht genau den gelieferten *.en.json", () => {
  const deliveredEnSlugs = LEGAL_SLUGS.filter((slug) =>
    existsSync(join(LEGAL_CONTENT_DIR, `${slug}.en.json`)),
  );
  const builtEnSlugs = existsSync(join(DIST_DIR, "legal"))
    ? readdirSync(join(DIST_DIR, "legal"))
    : [];
  assert.deepEqual(
    [...builtEnSlugs].sort(),
    [...deliveredEnSlugs].sort(),
    "gebaute EN-Rechtsseiten muessen genau den gelieferten *.en.json-Dateien entsprechen",
  );
});

test("EN-Rechtsseiten tragen noindex + Vorrangklausel, DE-Rechtsseiten kein noindex", () => {
  const deliveredEnSlugs = LEGAL_SLUGS.filter((slug) =>
    existsSync(join(LEGAL_CONTENT_DIR, `${slug}.en.json`)),
  );
  for (const slug of deliveredEnSlugs) {
    const html = readDist(`legal/${slug}/index.html`);
    assert.match(html, /<html lang="en"/, `legal/${slug} sollte lang=en sein`);
    assert.ok(
      html.includes('<meta name="robots" content="noindex">') ||
        html.includes('<meta content="noindex" name="robots">'),
      `legal/${slug} fehlt <meta name="robots" content="noindex">`,
    );
    assert.ok(html.includes(LEGAL_TRANSLATION_NOTICE), `legal/${slug} fehlt die Vorrangklausel`);
  }

  for (const page of LEGAL_PAGES) {
    const html = readDist(page);
    assert.ok(!html.includes('content="noindex"'), `${page} darf kein noindex tragen`);
  }
});

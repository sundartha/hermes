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
import { PLAN_CATALOG } from "../src/lib/plans.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST_DIR = join(WEB_ROOT, "dist-test");
const LEGAL_CONTENT_DIR = join(WEB_ROOT, "src/data/legal");

// Markenrot darf im gerenderten Output der Unterseiten NICHT auftauchen.
const BRAND_RED = "#e60000";

// Beleg, dass eine Seite das geteilte Site-Chrome nutzt (Marke + Flügel-Logo).
// Seit dem Hermes-Neubau traegt die Hülle (layouts/Hermes.astro) den Flügel
// statt der Sandale — die Sandale ist mit layouts/Site.astro verwaist.
const SITE_CHROME_MARKERS = ["by Sundartha", "hermes-wing.png"];

const MARKETING_PAGES = [
  "so-funktionierts/index.html",
  "preise/index.html",
  "registrieren/index.html",
  "404.html",
  // 312k-P3: oeffentliche Kuendigungsseite, dieselbe Hermes-Huelle wie so-funktionierts.
  "kuendigen/index.html",
];
const LEGAL_PAGES = [
  "impressum/index.html",
  "datenschutz/index.html",
  "agb/index.html",
];

// Sprachen nach dem Neubau (Owner-Entscheidung: Deutsch ist die Standardsprache
// der Marketing-Seiten; nur die beiden Rand-Seiten blieben englisch wie zuvor).
const DE_PAGES = [
  "so-funktionierts/index.html",
  "preise/index.html",
  "kuendigen/index.html",
  ...LEGAL_PAGES,
];
const EN_PAGES = ["registrieren/index.html", "404.html"];

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

test("Sprachen: DE-Seiten lang=de, die beiden EN-Rand-Seiten lang=en", () => {
  for (const page of DE_PAGES) {
    assert.match(readDist(page), /<html lang="de"/, `${page} sollte lang=de sein`);
  }
  for (const page of EN_PAGES) {
    assert.match(readDist(page), /<html lang="en"/, `${page} sollte lang=en sein`);
  }
});

// Ganzzahl-Cents -> {major, minor} wie lib/plans.js formatPlanPrice. Beide
// Preis-Tests unten leiten ihre Erwartung hieraus ab, nie aus einer Zahl im Text.
function priceParts(amountCents) {
  const CENTS_PER_MAJOR = 100;
  const MINOR_DIGITS = 2;
  return {
    major: Math.floor(amountCents / CENTS_PER_MAJOR),
    minor: String(amountCents % CENTS_PER_MAJOR).padStart(MINOR_DIGITS, "0"),
  };
}

test("Pricing rendert EUR aus dem Katalog (beide Tarife)", () => {
  // BK0/AM3: Preise kommen aus lib/plans.js (Spiegel der Backend-SSoT), seit dem
  // Stripe-Live-Cutover EUR. Die Seite ist seit dem Neubau deutsch und schreibt
  // die Betraege in deutscher Notation ("4,99 €"), abgeleitet aus amountCents —
  // der Test bleibt damit an den Katalog gekoppelt, nicht an eine Zahl im Text.
  const html = readDist("preise/index.html");
  for (const plan of PLAN_CATALOG) {
    const major = Math.floor(plan.amountCents / 100);
    const minor = String(plan.amountCents % 100).padStart(2, "0");
    assert.ok(
      html.includes(`${major},${minor} €`),
      `preise: Katalogpreis ${major},${minor} € (${plan.slug}) fehlt`,
    );
    assert.ok(
      html.includes(`${plan.includedMinutes} Minuten`),
      `preise: Inklusivminuten ${plan.includedMinutes} (${plan.slug}) fehlen`,
    );
    assert.ok(html.includes(plan.name), `preise: Tarifname ${plan.name} fehlt`);
  }
});

test("Startseite: Preise in beiden Sprachen aus dem Katalog, je in der richtigen Notation", () => {
  // Die Startseite ist seit dem Default-Wechsel englisch im Markup; Deutsch liegt
  // als Woerterbuch in scripts/hermes-scroll.js. Beide Fassungen muessen aus
  // DEMSELBEN Katalog stammen und die Notation ihrer Sprache tragen: englisch
  // "€4.99" (Punkt, Symbol vorn), deutsch "4,99 €" (Komma, Symbol nachgestellt).
  // Der Test haengt an amountCents, nicht an einer Zahl im Text - genau wie der
  // /preise-Test darueber.
  // Gemessen wird der PREIS-KNOTEN, nicht die ganze Seite: "4,99 €" steht
  // legitim auch im deutschen AGB-Text im Rechtstext-Blatt.
  const html = readDist("index.html");
  const dict = readFileSync(join(WEB_ROOT, "src/scripts/hermes-scroll.js"), "utf8");
  for (const plan of PLAN_CATALOG) {
    const { major, minor } = priceParts(plan.amountCents);
    const key = `${plan.slug}Price`;
    assert.ok(
      html.includes(`data-i18n="${key}">€${major}.${minor}<`),
      `Startseite: englischer Katalogpreis €${major}.${minor} (${plan.slug}) fehlt`,
    );
    assert.ok(
      dict.includes(`${key}: "${major},${minor} €"`),
      `DE-Woerterbuch: deutscher Katalogpreis ${major},${minor} € (${plan.slug}) fehlt`,
    );
  }
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

// Cookie-Einwilligung (§ 25 TDDDG): jede oeffentliche Seite traegt den Banner,
// den Wiederoeffnen-Link und das Handy-Viewport-Meta; ohne PUBLIC_ANALYTICS_*
// darf KEIN Mess-Platzhalter im Output stehen (fail-closed, s. AnalyticsSlot).
const PUBLIC_PAGES = ["index.html", ...MARKETING_PAGES, ...LEGAL_PAGES];

test("Cookie-Einwilligung: Banner + Wiederoeffnen-Link + viewport-fit auf jeder oeffentlichen Seite", () => {
  for (const page of PUBLIC_PAGES) {
    const html = readDist(page);
    assert.ok(html.includes("data-consent-root"), `${page} fehlt der Einwilligungs-Banner`);
    assert.ok(html.includes('data-consent-action="necessary"'), `${page}: "Nur notwendige" fehlt`);
    assert.ok(html.includes('data-consent-action="all"'), `${page}: "Alle akzeptieren" fehlt`);
    assert.ok(html.includes("data-consent-open"), `${page} fehlt "Cookie-Einstellungen"`);
    assert.match(html, /name="viewport" content="[^"]*viewport-fit=cover/, `${page} fehlt viewport-fit=cover`);
  }
});

test("ohne PUBLIC_ANALYTICS_* steht kein Mess-Platzhalter im Output", () => {
  for (const page of PUBLIC_PAGES) {
    assert.ok(!readDist(page).includes('type="text/plain"'), `${page} enthaelt einen Analytics-Platzhalter`);
  }
});

test("Datenschutz nennt die lokale Speicherung (hermes.lang, hermes.consent)", () => {
  const html = readDist("datenschutz/index.html");
  assert.ok(html.includes("hermes.lang"), "hermes.lang fehlt im Datenschutztext");
  assert.ok(html.includes("hermes.consent"), "hermes.consent fehlt im Datenschutztext");
});

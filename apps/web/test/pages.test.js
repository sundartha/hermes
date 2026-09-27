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
import {
  LEGAL_SLUGS,
  LEGAL_TRANSLATION_NOTICE,
  indexLegalContent,
  legalFooterLinks,
} from "../src/lib/legal.js";
import { PLAN_CATALOG } from "../src/lib/plans.js";
import { LOGIN_URL } from "../src/lib/routes.js";

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
  // Oeffentliche Support-Seite (englisch), dieselbe Hermes-Huelle.
  "support/index.html",
];
const LEGAL_PAGES = [
  "impressum/index.html",
  "datenschutz/index.html",
  "agb/index.html",
];

// Sprachen nach dem Neubau (Owner-Entscheidung: Deutsch ist die Standardsprache
// der Marketing-Seiten; die beiden Rand-Seiten blieben englisch wie zuvor). Die
// Support-Seite ist englisch (Marketing-Texte Englisch, Rechtstexte Deutsch).
const DE_PAGES = [
  "so-funktionierts/index.html",
  "preise/index.html",
  "kuendigen/index.html",
  ...LEGAL_PAGES,
];
const EN_PAGES = ["registrieren/index.html", "404.html", "support/index.html"];

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

test("Sprachen: DE-Seiten lang=de, die EN-Seiten lang=en", () => {
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

test("Datenschutz nennt die lokale Speicherung (Sprachwahl, Cookie-Entscheidung)", () => {
  // Der genannte Eintrag muss der WIRKLICH geschriebene sein: gemessen wird der
  // Schluessel aus scripts/hermes-scroll.js, nicht ein fest getippter Name.
  // Sonst nennt der Datenschutztext nach einer Umbenennung einen Eintrag, den
  // es nicht mehr gibt (§ 25 TDDDG verlangt die zutreffende Angabe).
  const scroll = readFileSync(join(WEB_ROOT, "src/scripts/hermes-scroll.js"), "utf8");
  const langKey = (scroll.match(/const LANG_KEY = "([^"]+)"/) || [])[1];
  assert.ok(langKey, "LANG_KEY in hermes-scroll.js nicht gefunden");
  const html = readDist("datenschutz/index.html");
  assert.ok(html.includes(langKey), `${langKey} fehlt im Datenschutztext`);
  assert.ok(html.includes("hermes.consent"), "hermes.consent fehlt im Datenschutztext");
});

// Support-Seite: die oeffentliche Support-URL fuer die OpenAI-Einreichung ("Privacy
// policy, terms, support, and website URLs are public and match the publisher
// identity.", developers.openai.com/plugins/deploy/submission). Geprueft wird der
// GEBAUTE Output: indexierbar, kanonisch auf sundartha.com, Kontakt nur aus dem
// Bestand, keine Zusage ohne Beleg, keine interne Kennung, keine fremde Quelle.
const SUPPORT_PAGE = "support/index.html";
// Sitemap-Schreibweise ohne Schraegstrich wie die uebrigen Eintraege; der gebaute
// canonical-Link traegt ihn (Astro-Verzeichnis-Format), beides zeigt auf dieselbe Seite.
const SUPPORT_CANONICAL = "https://sundartha.com/support";
const SUPPORT_CANONICAL_LINK = /<link rel="canonical" href="https:\/\/sundartha\.com\/support\/?"/;
const PUBLIC_CONTACT = "kontakt@sundartha.com";
const PUBLISHER_HOST = "sundartha.com";
// Zusagen, fuer die es keinen Beleg gibt: Frist, Rund-um-die-Uhr, Telefonnummer.
const UNBACKED_PROMISE = /24\/7|\bSLA\b|within \d+|business days|\+\d{2}[\s\d]{6,}/i;
// Interne Kennungen aus Plan und Befundlisten gehoeren nie auf eine oeffentliche Seite.
const INTERNAL_ID = /\b(T2-\d+|OW-[A-Z]|O-\d+|N-\d+|H-\d+)\b/;

// Sichtbarer Text: Skripte/Styles raus, dann alle Tags. So pruefen die Regexe den
// Text, den ein Mensch liest - nicht die gehashten Asset-Namen in Attributen.
function visibleText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ");
}

function metaDescription(html) {
  return (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
}

function absoluteLinkHosts(html) {
  return [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map(
    (match) => new URL(match[1]).hostname,
  );
}

// Dieselbe Quelle wie der Build (lib/legal-content.js per import.meta.glob), hier aus
// den Dateien gelesen - so zeigt die Erwartung automatisch auf eine kuenftige EN-Fassung.
function englishLegalTargets() {
  const modules = Object.fromEntries(
    readdirSync(LEGAL_CONTENT_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => [
        `../data/legal/${name}`,
        JSON.parse(readFileSync(join(LEGAL_CONTENT_DIR, name), "utf8")),
      ]),
  );
  return legalFooterLinks(indexLegalContent(modules), "en").map((link) => link.href);
}

test("Support-Seite: Positiv-Kontrolle - die Verbots-Regexe schlagen an", () => {
  // Ohne diese Kontrolle saehe eine kaputte Regex aus wie eine saubere Seite.
  for (const sample of ["We answer 24/7.", "Our SLA", "within 24 hours", "3 business days", "+49 176 1234567"]) {
    assert.match(sample, UNBACKED_PROMISE, `Regex verfehlt "${sample}"`);
  }
  for (const sample of ["see T2-19", "OW-K", "O-7", "N-12", "H-3"]) {
    assert.match(sample, INTERNAL_ID, `Regex verfehlt "${sample}"`);
  }
});

test("Support-Seite: indexierbar, kanonisch, Kontakt aus dem Bestand, keine erfundenen Zusagen", () => {
  const html = readDist(SUPPORT_PAGE);
  assert.ok(!html.includes('name="robots"'), "Support-Seite darf kein robots-Meta tragen (Produktion indexierbar)");
  assert.match(html, SUPPORT_CANONICAL_LINK, `Support-Seite fehlt canonical ${SUPPORT_CANONICAL}`);
  assert.ok(html.includes(`href="mailto:${PUBLIC_CONTACT}"`), "Support-Seite fehlt der mailto-Kontakt");
  assert.ok(html.includes('href="/kuendigen"'), "Support-Seite fehlt der Link auf /kuendigen");
  for (const target of englishLegalTargets()) {
    assert.ok(html.includes(`href="${target}"`), `Support-Seite fehlt der Rechtslink ${target}`);
  }
  const text = `${visibleText(html)} ${metaDescription(html)}`;
  assert.doesNotMatch(text, UNBACKED_PROMISE, "Support-Seite verspricht etwas ohne Beleg");
  assert.doesNotMatch(text, INTERNAL_ID, "Support-Seite nennt eine interne Kennung");
});

test("Support-Seite: keine Quelle oder kein Link auf einen fremden Host", () => {
  // Erlaubt: die Publisher-Domain und der Gateway-Host des Login-Links (derselbe Wert,
  // den der Build aus PUBLIC_GATEWAY_URL zieht, lib/routes.js).
  const allowed = new Set([PUBLISHER_HOST, new URL(LOGIN_URL).hostname]);
  for (const host of absoluteLinkHosts(readDist(SUPPORT_PAGE))) {
    assert.ok(allowed.has(host), `Support-Seite verweist auf fremden Host ${host}`);
  }
});

test("jede oeffentliche Seite verlinkt /support", () => {
  for (const page of PUBLIC_PAGES) {
    assert.ok(readDist(page).includes('href="/support"'), `${page} fehlt der Link auf /support`);
  }
});

test("Sitemap enthaelt die Support-Seite", () => {
  const sitemap = readFileSync(join(WEB_ROOT, "public/sitemap.xml"), "utf8");
  assert.ok(sitemap.includes(`<loc>${SUPPORT_CANONICAL}</loc>`), "sitemap.xml fehlt /support");
});

// Die Erklaer-Demo nennt nur Werkzeuge, die der Server heute anbietet, und zeigt den
// heutigen Ablauf: die KI bereitet den Anruf vor (prepare_call), der Mensch bestaetigt
// ihn in der Hermes-Karte. Einen Kalender hat Hermes nicht mehr.
const RETIRED_DEMO_CLAIMS = /get_transcript|get_my_number|get_calendar|added it to your calendar|Termin eingetragen/;
const DEMO_PAGES = ["index.html", "so-funktionierts/index.html"];

test("Demo nennt nur heutige Werkzeuge und keinen Kalender", () => {
  for (const page of DEMO_PAGES) {
    const html = readDist(page);
    assert.ok(html.includes("prepare_call"), `${page}: Demo zeigt prepare_call nicht`);
    assert.doesNotMatch(html, RETIRED_DEMO_CLAIMS, `${page}: Demo nennt ein altes Werkzeug oder den Kalender`);
  }
  // Das DE-Woerterbuch des Laufzeit-Umschalters traegt die Demo-Texte ein zweites Mal.
  const scroll = readFileSync(join(WEB_ROOT, "src/scripts/hermes-scroll.js"), "utf8");
  assert.ok(scroll.includes("prepare_call"), "hermes-scroll.js: Demo zeigt prepare_call nicht");
  assert.doesNotMatch(scroll, RETIRED_DEMO_CLAIMS, "hermes-scroll.js nennt ein altes Werkzeug oder den Kalender");
});

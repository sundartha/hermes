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
import { PLAN_CATALOG, formatPlanPrice } from "../src/lib/plans.js";
import { CANCEL_URL, LOGIN_URL } from "../src/lib/routes.js";
import { homeHref } from "../src/lib/home-anchors.js";
import { CANCEL_BUTTON_LABEL, CANCEL_BUTTON_LABEL_EN } from "../src/lib/subscribe.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST_DIR = join(WEB_ROOT, "dist-test");
const LEGAL_CONTENT_DIR = join(WEB_ROOT, "src/data/legal");

const BRAND_RED = "#e60000";

const SITE_CHROME_MARKERS = ["by Sundartha", "hermes-wing.png"];

const MARKETING_PAGES = [
  "registrieren/index.html",
  "404.html",
  "kuendigen/index.html",
  "support/index.html",
];
const LEGAL_PAGES = [
  "impressum/index.html",
  "datenschutz/index.html",
  "agb/index.html",
];

const DE_PAGES = ["kuendigen/index.html", ...LEGAL_PAGES];
const EN_PAGES = ["registrieren/index.html", "404.html", "support/index.html"];

function readDist(relativePath) {
  return readFileSync(join(DIST_DIR, relativePath), "utf8");
}

function linkedStylesheets(html) {
  const hrefs = [...html.matchAll(/<link[^>]+href="(\/[^"]+\.css)"/g)].map(
    (match) => match[1],
  );
  return hrefs.map((href) => readDist(href.replace(/^\//, "")));
}

before(() => {
  rmSync(DIST_DIR, { recursive: true, force: true });
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

function priceParts(amountCents) {
  const CENTS_PER_MAJOR = 100;
  const MINOR_DIGITS = 2;
  return {
    major: Math.floor(amountCents / CENTS_PER_MAJOR),
    minor: String(amountCents % CENTS_PER_MAJOR).padStart(MINOR_DIGITS, "0"),
  };
}

const HOME_REDIRECTS = [
  { page: "so-funktionierts/index.html", anchor: "so-funktionierts" },
  { page: "preise/index.html", anchor: "preise" },
];

test("Weichen: /so-funktionierts und /preise fuehren zur Sektion der Startseite", () => {
  for (const { page, anchor } of HOME_REDIRECTS) {
    const html = readDist(page);
    const target = homeHref(anchor);
    assert.ok(
      html.includes(`<meta http-equiv="refresh" content="0; url=${target}">`),
      `${page}: Meta-Refresh auf ${target} fehlt`,
    );
    assert.ok(
      html.includes(`<a href="${target}">`),
      `${page}: sichtbarer Rueckfall-Link auf ${target} fehlt`,
    );
    assert.ok(html.includes('<meta name="robots" content="noindex">'), `${page}: noindex fehlt`);
    assert.ok(
      html.includes('<link rel="canonical" href="https://sundartha.com/">'),
      `${page}: canonical auf die Startseite fehlt`,
    );
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), `${page}: Inline-Script (CSP)`);
    assert.ok(!/\sstyle=/.test(html), `${page}: style-Attribut (CSP)`);
    assert.ok(!html.includes("doc-title"), `${page}: traegt noch den alten Seiteninhalt`);
  }
  const sitemap = readFileSync(join(WEB_ROOT, "public/sitemap.xml"), "utf8");
  for (const { page } of HOME_REDIRECTS) {
    const url = `https://sundartha.com/${page.replace("/index.html", "")}<`;
    assert.ok(!sitemap.includes(url), `sitemap.xml fuehrt die Weiche ${url} noch als Seite`);
  }
});

test("Startseite: Preise in beiden Sprachen aus dem Katalog, je in der richtigen Notation", () => {
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

test("Handy-Startseite: Preise (EN/DE) und Minuten aus dem Katalog", () => {
  const html = readDist("index.html");
  const joined = (pick) => PLAN_CATALOG.map(pick).join("|");
  const en = joined((plan) => formatPlanPrice(plan.amountCents, plan.currency, "en"));
  const de = joined((plan) => formatPlanPrice(plan.amountCents, plan.currency, "de"));
  const minutes = joined((plan) => plan.includedMinutes);
  assert.ok(html.includes(`data-prices-en="${en}"`), `Handy: englische Katalogpreise ${en} fehlen`);
  assert.ok(html.includes(`data-prices-de="${de}"`), `Handy: deutsche Katalogpreise ${de} fehlen`);
  assert.ok(html.includes(`data-minutes="${minutes}"`), `Handy: Inklusivminuten ${minutes} fehlen`);
});

test("Handy-Startseite: DE-Fassung je Knoten, kein Inline-Style, Kuendigungs-Link je Sprache", () => {
  const html = readDist("index.html");
  const start = html.indexOf("data-mh");
  const mobile = html.slice(start, html.indexOf('class="page"'));
  assert.ok(start >= 0 && mobile.includes("mh-scroll"), "Handy-Fassung fehlt vor der Buehne");
  assert.ok(!mobile.includes('data-mh-de=""'), "leere deutsche Fassung im Handy-Markup");
  assert.ok(!/\sstyle=/.test(mobile), "style-Attribut im Handy-Markup (CSP)");
  assert.ok(!mobile.includes("data-open-sheet"), "Handy-Kopf traegt wieder einen Menue-Knopf");
  assert.ok(
    mobile.includes(
      `<a class="mh-link" href="${CANCEL_URL}"><span data-lang-only="en">${CANCEL_BUTTON_LABEL_EN}</span><span data-lang-only="de">${CANCEL_BUTTON_LABEL}</span></a>`,
    ),
    "Kuendigungs-Link im Handy-Fuss fehlt oder traegt eine Uebersetzung",
  );
});

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
  const scroll = readFileSync(join(WEB_ROOT, "src/scripts/hermes-scroll.js"), "utf8");
  const langKey = (scroll.match(/const LANG_KEY = "([^"]+)"/) || [])[1];
  assert.ok(langKey, "LANG_KEY in hermes-scroll.js nicht gefunden");
  const html = readDist("datenschutz/index.html");
  assert.ok(html.includes(langKey), `${langKey} fehlt im Datenschutztext`);
  assert.ok(html.includes("hermes.consent"), "hermes.consent fehlt im Datenschutztext");
});

const SUPPORT_PAGE = "support/index.html";
const SUPPORT_CANONICAL = "https://sundartha.com/support";
const SUPPORT_CANONICAL_LINK = /<link rel="canonical" href="https:\/\/sundartha\.com\/support\/?"/;
const PUBLIC_CONTACT = "kontakt@sundartha.com";
const PUBLISHER_HOST = "sundartha.com";
const UNBACKED_PROMISE = /24\/7|\bSLA\b|within \d+|business days|\+\d{2}[\s\d]{6,}/i;
const INTERNAL_ID = /\b(T2-\d+|OW-[A-Z]|O-\d+|N-\d+|H-\d+)\b/;
const TRANSCRIPT_PROMISE = /with (its|their) transcripts?|and (its|their) transcripts?/i;
const TRANSCRIPT_DELETION_NOTE = /transcript of a call is normally deleted once its summary has been created/;
const PROVIDER_RETENTION_NOTE = /voice platform provider stores conversations separately and does not currently delete them automatically/;
const GLUED_LINK = /[A-Za-z]<a\s/;

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
  for (const sample of ["We answer 24/7.", "Our SLA", "within 24 hours", "3 business days", "+49 176 1234567"]) {
    assert.match(sample, UNBACKED_PROMISE, `Regex verfehlt "${sample}"`);
  }
  for (const sample of ["see T2-19", "OW-K", "O-7", "N-12", "H-3"]) {
    assert.match(sample, INTERNAL_ID, `Regex verfehlt "${sample}"`);
  }
  for (const sample of ["each of your calls with its transcript", "your calls and their transcripts"]) {
    assert.match(sample, TRANSCRIPT_PROMISE, `Regex verfehlt "${sample}"`);
  }
  for (const sample of ['by email<a href="mailto:x">', 'Our<a href="/kuendigen">']) {
    assert.match(sample, GLUED_LINK, `Regex verfehlt "${sample}"`);
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
  assert.doesNotMatch(text, TRANSCRIPT_PROMISE, "Support-Seite verspricht Transkripte im Kundenbereich");
  const flatText = text.replace(/\s+/g, " ");
  assert.match(flatText, TRANSCRIPT_DELETION_NOTE, "Support-Seite fehlt der Loesch-Vorbehalt zum Transkript");
  assert.match(flatText, PROVIDER_RETENTION_NOTE, "Support-Seite fehlt der Vorbehalt zur Aufbewahrung beim Plattform-Anbieter");
  assert.doesNotMatch(html, GLUED_LINK, "Support-Seite klebt ein Wort an einen Link");
});

test("Support-Seite: keine Quelle oder kein Link auf einen fremden Host", () => {
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

const RETIRED_DEMO_CLAIMS =
  /get_transcript|get_my_number|get_calendar|added it to your calendar|Termin eingetragen|Summary & transcript|Zusammenfassung & Transkript/;
const DEMO_PAGES = ["index.html"];

test("Demo: Positiv-Kontrolle - die Verbots-Regex schlaegt an", () => {
  for (const sample of ["get_transcript", "Summary & transcript are waiting", "Zusammenfassung & Transkript liegen"]) {
    assert.match(sample, RETIRED_DEMO_CLAIMS, `Regex verfehlt "${sample}"`);
  }
});

test("Demo nennt nur heutige Werkzeuge, keinen Kalender und kein Dashboard-Transkript", () => {
  for (const page of DEMO_PAGES) {
    const html = readDist(page);
    if (html.includes("hd-toolcall")) assert.ok(html.includes("prepare_call"), `${page}: Demo zeigt prepare_call nicht`);
    assert.doesNotMatch(html, RETIRED_DEMO_CLAIMS, `${page}: Seite nennt ein altes Werkzeug, den Kalender oder ein Dashboard-Transkript`);
  }
  const agents = readFileSync(join(WEB_ROOT, "public/agents.md"), "utf8");
  assert.ok(agents.includes("prepare_call"), "agents.md: prepare_call fehlt");
  assert.doesNotMatch(agents, RETIRED_DEMO_CLAIMS, "agents.md nennt ein altes Werkzeug oder den Kalender");
  const scroll = readFileSync(join(WEB_ROOT, "src/scripts/hermes-scroll.js"), "utf8");
  assert.ok(scroll.includes("prepare_call"), "hermes-scroll.js: Demo zeigt prepare_call nicht");
  assert.doesNotMatch(scroll, RETIRED_DEMO_CLAIMS, "hermes-scroll.js nennt ein altes Werkzeug, den Kalender oder ein Dashboard-Transkript");
});

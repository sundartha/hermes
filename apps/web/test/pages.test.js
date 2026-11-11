import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Window } from "happy-dom";
import {
  LEGAL_SLUGS,
  LEGAL_TRANSLATION_NOTICE,
  indexLegalContent,
  legalFooterLinks,
} from "../src/lib/legal.js";
import { CLAUDE_CONNECT_URL } from "../src/lib/agent-docs.js";
import { PLAN_CATALOG } from "../src/lib/plans.js";
import { CANCEL_URL, LOGIN_URL } from "../src/lib/routes.js";
import { homeHref } from "../src/lib/home-anchors.js";
import { HOME_GERMAN } from "../src/lib/home-german.js";
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

function pricingSection(html) {
  const start = html.indexOf('<section id="pricing"');
  assert.ok(start >= 0, "Startseite: Sektion #pricing fehlt");
  return html.slice(start, html.indexOf("</section>", start));
}

test("Startseite: Preise in beiden Sprachen aus dem Katalog, je in der richtigen Notation", () => {
  const pricing = pricingSection(readDist("index.html"));
  for (const plan of PLAN_CATALOG) {
    const { major, minor } = priceParts(plan.amountCents);
    assert.ok(
      pricing.includes(
        `<span data-lang-only="en">€${major}.${minor}</span><span data-lang-only="de">${major},${minor} €</span>`,
      ),
      `Startseite: Katalogpreis ${plan.slug} fehlt als €${major}.${minor} (EN) / ${major},${minor} € (DE)`,
    );
  }
});

test("Startseite: Minuten und Nummer je Tarif aus dem Katalog", () => {
  const doc = homeDocument();
  const headers = [...doc.querySelectorAll("#pricing thead th[scope=col]")].map((node) => node.textContent.trim());
  assert.equal(headers.length, PLAN_CATALOG.length, "je Tarif eine Spalte");
  const columns = PLAN_CATALOG.map((plan) => headers.findIndex((text) => text.startsWith(plan.name)));
  assert.ok(!columns.includes(-1), "Tarif-Spalte fehlt");
  const cells = (key) => {
    const row = doc.querySelector(`#pricing tbody th[data-i18n="${key}"]`);
    assert.ok(row, `Zeile ${key} fehlt`);
    return [...row.parentElement.querySelectorAll("td")].map((cell) => cell.textContent.trim());
  };
  const minutes = cells("rowMinutes");
  const numbers = cells("rowNumber");
  for (const [index, plan] of PLAN_CATALOG.entries()) {
    const column = columns[index];
    assert.equal(minutes[column], String(plan.includedMinutes), `${plan.name}: Minuten`);
    assert.equal(numbers[column], String(plan.numberCount), `${plan.name}: Nummern`);
  }
});

test("Startseite: kein Inline-Style, Kuendigungs-Link je Sprache aus den Konstanten", () => {
  const html = readDist("index.html");
  assert.ok(!/\sstyle=/.test(html), "style-Attribut auf der Startseite (CSP)");
  assert.ok(!/\son[a-z]+=/i.test(html), "Inline-Handler auf der Startseite (CSP)");
  assert.ok(
    html.includes(
      `<a class="f-cancel" href="${CANCEL_URL}"><span data-lang-only="en">${CANCEL_BUTTON_LABEL_EN}</span><span data-lang-only="de">${CANCEL_BUTTON_LABEL}</span></a>`,
    ),
    "Kuendigungs-Link im Fuss fehlt oder traegt eine Uebersetzung",
  );
  const index = readFileSync(join(WEB_ROOT, "src/pages/index.astro"), "utf8");
  assert.ok(
    index.includes("<BiText en={CANCEL_BUTTON_LABEL_EN} de={CANCEL_BUTTON_LABEL} />"),
    "Kuendigungs-Wortlaut kommt nicht aus den benannten Konstanten",
  );
  assert.ok(!index.includes(`>${CANCEL_BUTTON_LABEL}<`), "fest verdrahteter deutscher Wortlaut auf der Startseite");
  const germanTexts = [...germanDictionary().values()];
  assert.ok(!germanTexts.some((text) => text.includes(CANCEL_BUTTON_LABEL)), "§ 312k-Wortlaut im DE-Woerterbuch");
  assert.ok(index.includes('import "../styles/lang-only.css";'), "Startseite blendet die zweite Sprache nicht aus");
  assert.match(
    readFileSync(join(WEB_ROOT, "src/styles/lang-only.css"), "utf8"),
    /html\[lang="de"\] \[data-lang-only="en"\],\s*html:not\(\[lang="de"\]\) \[data-lang-only="de"\] \{\s*display: none !important;/,
  );
});

function germanText(value) {
  if (typeof value === "string") return value;
  return value.map((part) => (typeof part === "string" ? part : part.text)).join("");
}

function germanDictionary() {
  return new Map(Object.entries(HOME_GERMAN).map(([key, value]) => [key, germanText(value)]));
}

function missingGermanKeys(html, dictionary) {
  const keys = [
    ...[...html.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/data-i18n-attr="([^"]+)"/g)].flatMap((match) =>
      match[1].split(";").map((pair) => (pair.split(":")[1] ?? "").trim()),
    ),
  ];
  return [...new Set(keys.filter((key) => !dictionary.has(key)))];
}

test("DE-Woerterbuch (home.js) kennt jeden data-i18n-Key der Startseite, keiner ist leer", () => {
  const sample = '<p data-i18n="known">x</p><p data-i18n="nope">y</p><img data-i18n-attr="alt:known;title:nope2">';
  assert.deepEqual(missingGermanKeys(sample, new Map([["known", "bekannt"]])), ["nope", "nope2"]);
  const dictionary = germanDictionary();
  assert.ok(dictionary.has("addClaude") && dictionary.has("ckTitle"), "Woerterbuch nicht gelesen");
  const missing = missingGermanKeys(readDist("index.html"), dictionary);
  assert.deepEqual(missing, [], `DE-Woerterbuch: Keys ohne deutsche Fassung: ${missing.join(", ")}`);
  const empty = [...dictionary].filter(([, text]) => text.trim() === "").map(([key]) => key);
  assert.deepEqual(empty, [], `DE-Woerterbuch: leere deutsche Fassung: ${empty.join(", ")}`);
});

test("Startseite: Rechtslinks im Fuss je Sprache (EN /legal/*, DE die verbindlichen Seiten)", () => {
  const html = readDist("index.html");
  const content = legalContent();
  const english = legalFooterLinks(content, "en");
  const german = legalFooterLinks(content, "de");
  for (const link of english) {
    const de = german.find(({ slug }) => slug === link.slug);
    assert.ok(
      new RegExp(`<a [^>]*href="${link.href}" data-href-de="${de.href}"`).test(html),
      `Fuss: ${link.slug} fuehrt nicht auf ${link.href} (EN) / ${de.href} (DE)`,
    );
    for (const href of [link.href, de.href]) {
      assert.ok(existsSync(join(DIST_DIR, href.slice(1), "index.html")), `${href} wird nicht gebaut`);
    }
  }
  const script = readFileSync(join(WEB_ROOT, "src/scripts/home.js"), "utf8");
  assert.ok(script.includes("[data-href-de]"), "home.js tauscht die Rechtslinks in der DE-Ansicht nicht");
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
  const i18n = readFileSync(join(WEB_ROOT, "src/lib/i18n.js"), "utf8");
  const langKey = (i18n.match(/const LANG_KEY = "([^"]+)"/) || [])[1];
  assert.ok(langKey, "LANG_KEY in lib/i18n.js nicht gefunden");
  const home = readFileSync(join(WEB_ROOT, "src/scripts/home.js"), "utf8");
  assert.ok(home.includes('from "../lib/i18n.js"'), "Startseite speichert die Sprachwahl nicht ueber lib/i18n.js");
  assert.ok(!/\b(localStorage|sessionStorage)\s*\./.test(home), "home.js speichert am Sprach-Modul vorbei");
  const html = readDist("datenschutz/index.html");
  assert.ok(html.includes(langKey), `${langKey} fehlt im Datenschutztext`);
  assert.ok(html.includes("hermes.consent"), "hermes.consent fehlt im Datenschutztext");
});

function legalContent() {
  const modules = Object.fromEntries(
    readdirSync(LEGAL_CONTENT_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => [
        `../data/legal/${name}`,
        JSON.parse(readFileSync(join(LEGAL_CONTENT_DIR, name), "utf8")),
      ]),
  );
  return indexLegalContent(modules);
}

const SUPPORT_PAGE = "support/index.html";
const SUPPORT_CANONICAL = "https://sundartha.com/support";
const SUPPORT_CANONICAL_LINK = /<link rel="canonical" href="https:\/\/sundartha\.com\/support\/?"/;
const PUBLIC_CONTACT = "kontakt@sundartha.com";
const PUBLISHER_HOST = "sundartha.com";
const UNBACKED_PROMISE = /24\/7|\bSLA\b|within \d+|business days|\+\d{2}[\s\d]{6,}/i;
const INTERNAL_ID = /\b(T2-\d+|OW-[A-Z]|O-\d+|N-\d+|H-\d+)\b/;
const TRANSCRIPT_PROMISE = /with (its|their) transcripts?|and (its|their) transcripts?/i;
const TRANSCRIPT_DELETION_NOTE = /word-for-word transcripts are deleted automatically after the retention period/;
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
  return legalFooterLinks(legalContent(), "en").map((link) => link.href);
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

test("Startseite und agents.md nennen nur heutige Werkzeuge, keinen Kalender und kein Dashboard-Transkript", () => {
  for (const page of DEMO_PAGES) {
    const html = readDist(page);
    if (html.includes("hd-toolcall")) assert.ok(html.includes("place_call"), `${page}: Demo zeigt place_call nicht`);
    assert.doesNotMatch(html, RETIRED_DEMO_CLAIMS, `${page}: Seite nennt ein altes Werkzeug, den Kalender oder ein Dashboard-Transkript`);
  }
  const agents = readFileSync(join(WEB_ROOT, "public/agents.md"), "utf8");
  assert.ok(agents.includes("place_call"), "agents.md: place_call fehlt");
  assert.doesNotMatch(agents, RETIRED_DEMO_CLAIMS, "agents.md nennt ein altes Werkzeug oder den Kalender");
  for (const source of ["src/scripts/home.js", "src/lib/home-german.js"]) {
    const text = readFileSync(join(WEB_ROOT, source), "utf8");
    assert.doesNotMatch(text, RETIRED_DEMO_CLAIMS, `${source} nennt ein altes Werkzeug, den Kalender oder ein Dashboard-Transkript`);
  }
});

const CLAUDE_USER_BUTTONS = {
  Hero: "#top .hbtns",
  Setup: "#setup .obtns",
  Abschluss: ".close .cbtns",
};

function homeDocument() {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  return new window.DOMParser().parseFromString(readDist("index.html"), "text/html");
}

function assertExternalClaudeLink(link, href, where) {
  assert.ok(link, `${where}: Link fehlt`);
  assert.equal(link.tagName, "A", `${where}: kein <a>`);
  assert.equal(link.getAttribute("href"), href, `${where}: falsches Ziel`);
  assert.equal(link.getAttribute("target"), "_blank", `${where}: target=_blank fehlt`);
  const rel = (link.getAttribute("rel") ?? "").split(/\s+/);
  assert.ok(rel.includes("noopener") && rel.includes("noreferrer"), `${where}: rel ohne noopener noreferrer`);
  assert.ok(
    ![...link.attributes].some((attr) => /^on/i.test(attr.name) || attr.name === "style"),
    `${where}: Inline-Handler oder style (CSP)`,
  );
}

test("Mit Claude verbinden: Nutzer-Link an allen Orten (Hero, Setup, Abschluss), sonst kein claude.ai-Link", () => {
  const doc = homeDocument();
  for (const [where, selector] of Object.entries(CLAUDE_USER_BUTTONS)) {
    const links = [...doc.querySelectorAll(`${selector} a[href*="claude.ai"]`)];
    assert.equal(links.length, 1, `${where}: genau ein Claude-Link`);
    assertExternalClaudeLink(links[0], CLAUDE_CONNECT_URL, where);
  }
  const links = [...doc.querySelectorAll('a[href*="claude.ai"]')];
  assert.equal(links.length, Object.keys(CLAUDE_USER_BUTTONS).length);
});

test("Mit Claude verbinden: EN im Markup, DE im Woerterbuch", () => {
  const doc = homeDocument();
  const expected = {
    addClaude: "Add to Claude",
    newTab: " (opens in new tab)",
    chatgptCopy: "ChatGPT · copy URL",
  };
  for (const [where, selector] of Object.entries(CLAUDE_USER_BUTTONS)) {
    const link = doc.querySelector(`${selector} a[href*="claude.ai"]`);
    assert.ok(link.querySelector('[data-i18n="newTab"]'), `${where}: Hinweis auf neuen Tab fehlt`);
  }
  for (const where of ["Hero", "Abschluss"]) {
    const link = doc.querySelector(`${CLAUDE_USER_BUTTONS[where]} a[href*="claude.ai"]`);
    assert.ok(link.querySelector('[data-i18n="addClaude"]'), `${where}: data-i18n="addClaude" fehlt`);
  }
  assert.ok(doc.querySelector('#setup [data-copy] [data-i18n="chatgptCopy"]'), 'Setup: data-i18n="chatgptCopy" fehlt');
  for (const [key, text] of Object.entries(expected)) {
    const nodes = [...doc.querySelectorAll(`[data-i18n="${key}"]`)];
    assert.ok(nodes.length > 0, `data-i18n="${key}" fehlt`);
    for (const node of nodes) assert.equal(node.textContent.trimEnd(), text.trimEnd());
  }
});

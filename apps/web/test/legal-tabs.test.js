// Rechts-Blatt der Startseite: alle Ziele des Fussbands stehen als Reiter im Blatt
// (components/LegalTabs.astro, Owner-Wunsch 2026-09-27). Auch "Verträge kündigen" und
// "Support" oeffnen sich IM Blatt - vorher fuehrten sie auf eigene Seiten, von denen
// aus die anderen Texte nicht mehr zu sehen waren. Seite und Reiter teilen sich
// denselben Inhalt (components/site/CancelInfo.astro, SupportInfo.astro). Rein, ohne
// astro-Build: geprueft wird die Quelle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(WEB_ROOT, path), "utf8");
const tabs = read("src/components/LegalTabs.astro");
const mobile = read("src/components/MobileHome.astro");
const index = read("src/pages/index.astro");
const css = read("src/styles/hermes.css");
const langCss = read("src/styles/lang-only.css");

// Reiter mit eigenem Inhalt, der zugleich eine eigene Seite hat.
const INFO_TABS = [
  { slug: "cancel", href: "/kuendigen", page: "src/pages/kuendigen.astro", content: "CancelInfo" },
  { slug: "support", href: "/support", page: "src/pages/support.astro", content: "SupportInfo" },
];
const LEGAL_SLUGS = ["privacy", "imprint", "terms"];

test("Rechts-Blatt: Kuendigen und Support sind Reiter mit Inhalt im Blatt", () => {
  assert.match(
    index,
    /<LegalTabs legalDocs=\{legalDocs\} infoTabs=\{infoTabs\} contact=\{CONTACT\} \/>/,
  );
  assert.ok(tabs.includes("infoTabs.map"), "LegalTabs rendert die weiteren Reiter nicht");
  for (const tab of INFO_TABS) {
    assert.ok(
      index.includes(`{ slug: "${tab.slug}", href: "${tab.href}"`),
      `infoTabs: ${tab.slug} fehlt`,
    );
    // Beide Sprachfassungen im Reiter (Owner-Wunsch 2026-09-28), sichtbar ist die zur
    // Seitensprache passende (data-lang-only).
    const panel = index.slice(index.indexOf(`class="legal-info" data-legal-doc="${tab.slug}"`));
    const block = panel.slice(0, panel.indexOf("</div>\n        </div>") + 1);
    assert.match(
      block,
      new RegExp(`<div data-lang-only="en"><${tab.content}[ />]`),
      `Blatt: EN-Inhalt fuer ${tab.slug} fehlt`,
    );
    assert.match(
      block,
      new RegExp(`<div data-lang-only="de"><${tab.content}[ />]`),
      `Blatt: DE-Inhalt fuer ${tab.slug} fehlt`,
    );
  }
});

test("Rechts-Blatt: Seite und Reiter teilen sich denselben Inhalt", () => {
  for (const tab of INFO_TABS) {
    const page = read(tab.page);
    assert.ok(page.includes(`<${tab.content} />`), `${tab.page} nutzt ${tab.content} nicht`);
    assert.ok(!page.includes('class="step__title"'), `${tab.page} traegt noch eine eigene Kopie`);
  }
});

// Ausnahme seit 2026-10-01 (Owner-Entscheidung): "Verträge kündigen" fuehrt direkt zur
// Kuendigung im Kundenbereich (CANCEL_URL, test/cancel-intent.test.js), nicht in den
// Reiter. Der Reiter bleibt im Blatt erreichbar.
test("Fussband und Menue der Startseite: kein Link fuehrt aus dem Blatt heraus", () => {
  const home = `${index}\n${mobile}`;
  assert.ok(!home.includes('href="/kuendigen"'), "Kuendigen-Link fuehrt wieder in den Reiter");
  for (const tab of INFO_TABS.filter(({ slug }) => slug !== "cancel")) {
    const links = [...home.matchAll(new RegExp(`<a [^>]*href="${tab.href}"[^>]*>`, "g"))];
    assert.ok(links.length > 0, `${tab.href}: kein Link auf der Startseite (Test veraltet?)`);
    for (const [link] of links) {
      assert.ok(link.includes(`data-legal-open="${tab.slug}"`), `${link} verlaesst das Blatt`);
    }
  }
  // Jeder feste Reiter-Verweis trifft einen Reiter, den es gibt.
  const known = new Set([...LEGAL_SLUGS, ...INFO_TABS.map((tab) => tab.slug)]);
  for (const [, slug] of home.matchAll(/data-legal-open="([a-z]+)"/g)) {
    assert.ok(known.has(slug), `data-legal-open="${slug}" hat keinen Reiter`);
  }
});

test("Support im Blatt: Verweise auf Kuendigen und Rechtstexte wechseln den Reiter", () => {
  const support = read("src/components/site/SupportInfo.astro");
  assert.ok(index.includes("<SupportInfo inSheet />"), "Blatt nutzt die Blatt-Fassung nicht (EN)");
  assert.ok(
    index.includes('<SupportInfo lang="de" inSheet />'),
    "Blatt nutzt die Blatt-Fassung nicht (DE)",
  );
  assert.ok(support.includes('href="/kuendigen" data-legal-open={tabFor("cancel")}'));
  assert.ok(support.includes("data-legal-open={tabFor(link.slug)}"));
});

test("Rechts-Blatt: Kontakt und Cookie-Einstellungen bleiben Handlungen neben den Reitern", () => {
  const more = tabs.slice(tabs.indexOf('class="legal-more"'));
  assert.ok(more.includes("href={`mailto:${contact}`}"), "Kontakt fehlt");
  assert.ok(more.includes("data-consent-open"), "Cookie-Einstellungen fehlen");
});

test("Rechts-Blatt: alte Pillen und Schiebe-Daumen sind weg, die Reiter-Klassen sind gestylt", () => {
  assert.ok(!index.includes('class="legal-pills"'), "alte Pillen noch im Blatt");
  assert.ok(!css.includes(".legal-pills"), "totes CSS fuer .legal-pills");
  assert.ok(
    !css.includes("legal-seg__thumb") && !tabs.includes("legal-seg__thumb"),
    "toter Daumen",
  );
  for (const selector of ['.legal-pill[aria-current="page"]', ".legal-pill--info", ".legal-info"]) {
    assert.ok(css.includes(selector), `${selector} ist nicht gestylt`);
  }
});

// Owner-Wunsch 2026-09-28: steht die Startseite auf Englisch, ist auch alles im
// Rechts-Blatt englisch - Reiter, Titel, Texte, Kuendigen/Support -, auf Deutsch deutsch.
test("Rechts-Blatt: jeder Rechtstext steht in beiden Sprachen, sichtbar ist die zur Seitensprache", () => {
  for (const slug of LEGAL_SLUGS) {
    assert.ok(
      index.includes(`import ${slug}En from "../data/legal/${slug}.en.json";`),
      `${slug}: EN-Fassung nicht eingebunden`,
    );
  }
  assert.ok(index.includes("entry.docEn.sections.map"), "EN-Abschnitte fehlen im Blatt");
  assert.ok(index.includes("entry.doc.sections.map"), "DE-Abschnitte fehlen im Blatt");
  assert.ok(index.includes("{LEGAL_TRANSLATION_NOTICE}"), "EN-Fassung ohne Vorranghinweis");
  assert.match(
    langCss,
    /html\[lang="de"\] \[data-lang-only="en"\],\s*html:not\(\[lang="de"\]\) \[data-lang-only="de"\] \{\s*display: none !important;/,
  );
});

test("Kuendigen-Beschriftung: je Sprache aus den benannten Konstanten, nie im Woerterbuch", () => {
  const home = `${index}\n${mobile}\n${tabs}`;
  assert.ok(
    !home.includes(">Verträge kündigen<"),
    "fest verdrahteter deutscher Wortlaut auf der Startseite",
  );
  assert.ok(
    index.includes("CANCEL_LABEL = { en: CANCEL_BUTTON_LABEL_EN, de: CANCEL_BUTTON_LABEL }"),
  );
  assert.ok(mobile.includes("<BiText en={CANCEL_BUTTON_LABEL_EN} de={CANCEL_BUTTON_LABEL} />"));
  const scroll = read("src/scripts/hermes-scroll.js");
  assert.ok(!scroll.includes('"Verträge kündigen"'), "§ 312k-Wortlaut im DE-Woerterbuch");
});

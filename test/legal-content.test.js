// P14 (GAP-15-Mechanik) - Regressionsschutz fuer die Rechtsdokument-Logik
// (apps/web/src/lib/legal.js). Laeuft als reiner node-Test ueber Fixture-
// Objektmaps - kein Astro-Build noetig, weil indexLegalContent eine reine
// Funktion ueber der Modulmap ist (Muster: test/plans-catalog.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import {
  BINDING_LEGAL_LANGUAGE,
  LEGAL_SLUGS,
  LEGAL_TRANSLATION_NOTICE,
  indexLegalContent,
  findLegalDocument,
  legalRouteEntries,
  legalFooterLinks,
} from "../apps/web/src/lib/legal.js";

const VALID_DOC = Object.freeze({
  metaTitle: "Impressum",
  metaDescription: "Anbieterkennzeichnung",
  eyebrow: "Rechtliches",
  title: "Impressum",
  sections: [{ heading: "Anbieter", text: "Sundartha." }],
});

function fixture(overridesBySlugLang) {
  const modules = {};
  for (const [slugLang, doc] of Object.entries(overridesBySlugLang)) {
    modules[`../data/legal/${slugLang}.json`] = doc;
  }
  return modules;
}

test("indexLegalContent indiziert nach Slug und Sprache", () => {
  const content = indexLegalContent(
    fixture({
      ...Object.fromEntries(LEGAL_SLUGS.map((slug) => [`${slug}.de`, VALID_DOC])),
      "imprint.en": VALID_DOC,
    }),
  );
  assert.equal(content.imprint.de, VALID_DOC);
  assert.equal(content.imprint.en, VALID_DOC);
});

test("wirft bei unbekanntem Dateinamensschema - Fehlermeldung nennt den Pfad", () => {
  const modules = { "../data/legal/broken-name.txt": VALID_DOC };
  assert.throws(() => indexLegalContent(modules), /broken-name\.txt/);
});

test("wirft bei unbekanntem Slug", () => {
  assert.throws(
    () => indexLegalContent(fixture({ "unknownslug.de": VALID_DOC })),
    /unbekannter Slug "unknownslug"/,
  );
});

test("wirft bei fehlenden Pflichtfeldern / leerem sections - Fehlermeldung nennt den Pfad", () => {
  const noSections = { ...VALID_DOC, sections: [] };
  assert.throws(
    () => indexLegalContent(fixture({ "imprint.de": noSections })),
    /imprint\.de\.json.*sections/,
  );

  const noTitle = { ...VALID_DOC, title: "" };
  assert.throws(
    () => indexLegalContent(fixture({ "imprint.de": noTitle })),
    /imprint\.de\.json.*title/,
  );
});

test("wirft, wenn die verbindliche DE-Fassung eines Slugs fehlt", () => {
  assert.throws(
    () => indexLegalContent(fixture({ "imprint.en": VALID_DOC })),
    /verbindliche de-Fassung fehlt.*imprint|imprint.*verbindliche de-Fassung/,
  );
});

test("wirft, wenn eine nicht-verbindliche Fassung ein eigenes note-Feld mitbringt", () => {
  const withNote = { ...VALID_DOC, note: "eigene Vorrangklausel" };
  assert.throws(
    () => indexLegalContent(fixture({ "imprint.de": VALID_DOC, "imprint.en": withNote })),
    /note/,
  );
});

test("findLegalDocument liefert null ohne Sprach-Fallback", () => {
  const content = indexLegalContent(
    fixture(Object.fromEntries(LEGAL_SLUGS.map((slug) => [`${slug}.de`, VALID_DOC]))),
  );
  assert.equal(findLegalDocument(content, "imprint", "en"), null);
  assert.equal(findLegalDocument(content, "imprint", "de"), VALID_DOC);
});

test("legalRouteEntries ist leer ohne EN-Datei (O13: keine Seite -> 404)", () => {
  const content = indexLegalContent(
    fixture(Object.fromEntries(LEGAL_SLUGS.map((slug) => [`${slug}.de`, VALID_DOC]))),
  );
  assert.deepEqual(legalRouteEntries(content, "en"), []);
});

test("legalRouteEntries liefert genau die gelieferten EN-Slugs", () => {
  const content = indexLegalContent({
    ...fixture(Object.fromEntries(LEGAL_SLUGS.map((slug) => [`${slug}.de`, VALID_DOC]))),
    ...fixture({ "imprint.en": VALID_DOC }),
  });
  assert.deepEqual(
    legalRouteEntries(content, "en").map((entry) => entry.slug),
    ["imprint"],
  );
});

test("legalFooterLinks: DE-Route ohne Uebersetzung, EN-Route mit Uebersetzung", () => {
  const content = indexLegalContent({
    ...fixture(Object.fromEntries(LEGAL_SLUGS.map((slug) => [`${slug}.de`, VALID_DOC]))),
    ...fixture({ "imprint.en": VALID_DOC }),
  });
  const enLinks = legalFooterLinks(content, "en");
  const deLinks = legalFooterLinks(content, "de");

  const imprintEnLink = enLinks.find((l) => l.label === "Imprint");
  assert.equal(imprintEnLink.href, "/legal/imprint");
  const privacyEnLink = enLinks.find((l) => l.label === "Privacy");
  assert.equal(privacyEnLink.href, "/datenschutz");

  for (const link of deLinks) {
    assert.ok(!link.href.startsWith("/legal/"), `DE-Footer sollte nie auf /legal/ zeigen (${link.href})`);
  }
});

test("LEGAL_TRANSLATION_NOTICE ist nicht leer und benennt die deutsche Fassung als verbindlich", () => {
  assert.ok(LEGAL_TRANSLATION_NOTICE.trim().length > 0);
  assert.match(LEGAL_TRANSLATION_NOTICE, /German/i);
  assert.equal(BINDING_LEGAL_LANGUAGE, "de");
});

test("Echtdaten-Gate: die realen apps/web/src/data/legal/*.json bauen ohne Wurf", () => {
  const legalDir = path.join(ROOT, "apps/web/src/data/legal");
  const modules = {};
  for (const file of fs.readdirSync(legalDir)) {
    const doc = JSON.parse(fs.readFileSync(path.join(legalDir, file), "utf8"));
    modules[`../data/legal/${file}`] = doc;
  }

  const content = indexLegalContent(modules);
  for (const slug of LEGAL_SLUGS) {
    assert.ok(content[slug]?.de, `${slug}: verbindliche DE-Fassung fehlt in den Echtdaten`);
  }
});

test("apps/web/public/sitemap.xml enthaelt keine /legal/-URL", () => {
  const sitemap = fs.readFileSync(path.join(ROOT, "apps/web/public/sitemap.xml"), "utf8");
  assert.ok(!sitemap.includes("/legal/"), "sitemap.xml darf keine informative Uebersetzung indexieren");
});

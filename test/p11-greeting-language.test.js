import { test } from "node:test";
import assert from "node:assert/strict";
import {
  greetingForLanguage,
  greetingTemplatesFor,
  ALL_GREETING_TEMPLATES,
} from "../src/i18n/greeting-catalog.js";
import { withInboundNotice } from "../src/i18n/inbound-notice.js";
import { DEFAULT_GREETING } from "../src/store/defaults.js";
import { LOCALES, SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";

test("P11-G1 DE-Seed-Default auf einem EN-Tenant wird zur EN-Standardvorlage", () => {
  assert.equal(greetingForLanguage(DEFAULT_GREETING, "en"), greetingTemplatesFor("en")[0]);
});
test("P11-G2 DE-Seed-Default auf einem DE-Tenant bleibt unveraendert", () => {
  assert.equal(greetingForLanguage(DEFAULT_GREETING, "de"), DEFAULT_GREETING);
});

test("P11-G3 Freitext bleibt in JEDER Sprache unveraendert (Admin-Freitext-Schutz, D3)", () => {
  const freetext = "Mein eigener Text mit KI- und Transkriptionshinweis";
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.equal(greetingForLanguage(freetext, lang), freetext, `${lang}: Freitext veraendert`);
  }
});

test("P11-G4 jede Katalog-Vorlage jeder Sprache bleibt in ihrer eigenen Sprache unveraendert", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    for (const template of greetingTemplatesFor(lang)) {
      assert.equal(greetingForLanguage(template, lang), template, `${lang}: Vorlage veraendert`);
    }
  }
});

test("P11-G5 eine Vorlage EINER ANDEREN Sprache faellt auf die Standardvorlage der Anrufsprache zurueck", () => {
  const frTemplate = greetingTemplatesFor("fr")[1];
  assert.equal(greetingForLanguage(frTemplate, "en"), greetingTemplatesFor("en")[0]);
});

test("P11-G6 greetingTemplatesFor(lang)[0] === withInboundNotice(greetingDefault, inboundNotice) (Index-0-Invariante)", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.equal(
      greetingTemplatesFor(lang)[0],
      withInboundNotice(LOCALES[lang].greetingDefault, LOCALES[lang].inboundNotice),
      `${lang}: Index 0 ist nicht der Standard-Default`,
    );
  }
});

test("P11-G7 null/undefined gehen unveraendert durch (der Wurf-Pfad in voice.js bleibt erhalten)", () => {
  assert.equal(greetingForLanguage(null, "en"), null);
  assert.equal(greetingForLanguage(undefined, "en"), undefined);
});

test("P11-G8 ALL_GREETING_TEMPLATES ist die Sprach-Union aller Kataloge", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    for (const template of greetingTemplatesFor(lang)) {
      assert.ok(ALL_GREETING_TEMPLATES.includes(template), `${lang}-Vorlage fehlt in ALL_GREETING_TEMPLATES`);
    }
  }
});

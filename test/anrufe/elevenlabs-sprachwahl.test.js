import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_LANGUAGE } from "../../src/konfiguration/standardsprache.ts";
import { LOCALES, localeFor } from "../../src/i18n/locales.ts";

const BEKANNTE_SPRACHEN = Object.freeze(["de", "fr", "en"]);
const UNBEKANNTE_SPRACHEN = Object.freeze(["toString", "constructor", "__proto__", "hasOwnProperty", "xx", "", "DE"]);

test("localeFor: eine bekannte Sprache liefert ihren eigenen Eintrag", () => {
  for (const sprache of BEKANNTE_SPRACHEN) {
    assert.equal(localeFor(sprache), LOCALES[sprache]);
  }
  assert.notEqual(localeFor("de"), localeFor("fr"));
});

test("localeFor: eine unbekannte Sprache oder ein Vererbungsname liefert den Eintrag der Standardsprache", () => {
  for (const sprache of UNBEKANNTE_SPRACHEN) {
    assert.equal(localeFor(sprache), LOCALES[DEFAULT_LANGUAGE], sprache);
  }
  assert.equal(localeFor(undefined), LOCALES[DEFAULT_LANGUAGE]);
});

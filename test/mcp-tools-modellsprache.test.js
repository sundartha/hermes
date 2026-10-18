import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import { captureToolDescriptions } from "./gemeinsam/werkzeug-registrierung.js";

const REFERENCE_LANGUAGE = "en";

test("Werkzeugbeschreibungen sind fuer jede Sprache des Katalogs dieselben wie fuer Englisch", () => {
  const reference = captureToolDescriptions({ language: REFERENCE_LANGUAGE, consultAllowed: true });
  assert.ok(reference.size > 0, "die Referenz enthaelt Beschreibungen");
  assert.ok(SUPPORTED_LANGUAGES.includes(REFERENCE_LANGUAGE), "Englisch ist im Katalog");
  for (const language of SUPPORTED_LANGUAGES) {
    const captured = captureToolDescriptions({ language, consultAllowed: true });
    assert.deepEqual([...captured.keys()], [...reference.keys()], `${language}: dieselben Pfade wie Englisch`);
    for (const [path, text] of captured) {
      assert.ok(text.length > 0, `${language}: ${path} hat eine Beschreibung`);
      assert.equal(text, reference.get(path), `${language}: ${path} weicht von Englisch ab`);
    }
  }
});

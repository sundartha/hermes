import assert from "node:assert/strict";
import { test } from "node:test";

import { eroeffnungsVariablen, ersteAeusserung, offenlegungssatz } from "../../src/anrufe/start/anrufstart.ts";
import { localeFor } from "../../src/i18n/locales.ts";

test("eroeffnungsVariablen: opening_line und eroeffnung tragen genau die übergebenen Texte", () => {
  assert.deepEqual(eroeffnungsVariablen({ openingLine: "wegen der Lieferung", eroeffnung: "Guten Tag, hier KI" }), {
    opening_line: "wegen der Lieferung",
    eroeffnung: "Guten Tag, hier KI",
  });
  assert.deepEqual(eroeffnungsVariablen({ openingLine: "", eroeffnung: "" }), { opening_line: "", eroeffnung: "" });
});

for (const sprache of ["de", "en", "fr"]) {
  test(`offenlegungssatz (${sprache}): derselbe Wortlaut wie LOCALES.${sprache}.disclosure, mit und ohne Auftraggeber`, () => {
    const bundle = localeFor(sprache);
    assert.equal(offenlegungssatz(bundle, "Anna Beispiel"), bundle.disclosure("Anna Beispiel"));
    assert.equal(offenlegungssatz(bundle, null), bundle.disclosure(null));
    assert.notEqual(offenlegungssatz(bundle, "Anna Beispiel"), offenlegungssatz(bundle, null));
  });
}

const DE = localeFor("de");
const FR = localeFor("fr");

test("ersteAeusserung: gleiche Sprache gibt den Eröffnungs-Platzhalter, fremde Sprache Offenlegung vor dem Platzhalter", () => {
  assert.equal(ersteAeusserung({ providerLanguage: "de", offenlegung: DE, ownerName: "Anna Beispiel" }), "{{eroeffnung}}");
  assert.equal(
    ersteAeusserung({ providerLanguage: "fr", offenlegung: DE, ownerName: "Anna Beispiel" }),
    `${DE.disclosure("Anna Beispiel")} {{opening_line}}`,
  );
  assert.equal(ersteAeusserung({ providerLanguage: "de", offenlegung: FR, ownerName: null }), `${FR.disclosure(null)} {{opening_line}}`);
});

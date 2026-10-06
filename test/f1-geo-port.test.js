import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStubGeoLookup, nullGeoLookup } from "../src/geo/stub.js";
import { makeMaxmindGeoLookup } from "../src/geo/maxmind.js";
import { normCountry, resolveOnboardCountry, resolveNumberCountry } from "../src/geo/resolve.js";
import { languageForCountry, LANGUAGE_FOR_COUNTRY, localeFor } from "../src/i18n/locales.js";
import { DEFAULT_COUNTRY, DEFAULT_LANGUAGE, setWorldDefaultLanguageEnabled } from "../src/store/defaults.js";

test("makeStubGeoLookup: bekannte IP -> {country}; unbekannte -> null", () => {
  const lookup = makeStubGeoLookup({ "1.2.3.4": "FR", "9.9.9.9": "GB" });
  assert.deepEqual(lookup("1.2.3.4"), { country: "FR" });
  assert.deepEqual(lookup("9.9.9.9"), { country: "GB" });
  assert.equal(lookup("0.0.0.0"), null, "unbekannte IP -> null");
  assert.equal(lookup(undefined), null, "fehlende IP -> null");
});

test("makeStubGeoLookup: ohne Tabelle loest nichts auf (null)", () => {
  const lookup = makeStubGeoLookup();
  assert.equal(lookup("1.2.3.4"), null);
});

test("nullGeoLookup: loest NIE auf -> immer null (DE-Fallback beim Aufrufer)", () => {
  assert.equal(nullGeoLookup("1.2.3.4"), null);
  assert.equal(nullGeoLookup(""), null);
});

test("makeMaxmindGeoLookup: ohne Reader/Asset fail-safe null (kein Crash, kein Dep)", () => {
  const withPath = makeMaxmindGeoLookup("/nonexistent/GeoLite2-Country.mmdb");
  const noPath = makeMaxmindGeoLookup("");
  assert.equal(withPath("1.2.3.4"), null);
  assert.equal(noPath("1.2.3.4"), null);
  assert.equal(makeMaxmindGeoLookup()("1.2.3.4"), null, "ohne dbPath-Arg ebenfalls null");
});

test("languageForCountry: DE/AT/CH -> de, FR -> fr, GB/IE -> en", () => {
  assert.equal(languageForCountry("DE"), "de");
  assert.equal(languageForCountry("AT"), "de");
  assert.equal(languageForCountry("CH"), "de");
  assert.equal(languageForCountry("FR"), "fr");
  assert.equal(languageForCountry("GB"), "en");
  assert.equal(languageForCountry("IE"), "en");
});

test("languageForCountry: case-insensitiv (fr -> fr)", () => {
  assert.equal(languageForCountry("fr"), "fr");
  assert.equal(languageForCountry("gb"), "en");
});

test("LANG-09 (Mechanismus, gruen) - languageForCountry ist auch fuer Tabellen-fremde Laender case-insensitiv", () => {
  assert.equal(languageForCountry("us"), DEFAULT_LANGUAGE);
  assert.equal(languageForCountry("Us"), DEFAULT_LANGUAGE);
  assert.equal(languageForCountry("US"), DEFAULT_LANGUAGE);
});

test("LANGUAGE_FOR_COUNTRY ist frozen (eine Quelle, kein Laufzeit-Drift)", () => {
  assert.ok(Object.isFrozen(LANGUAGE_FOR_COUNTRY));
});

test("languageForCountry liefert 'en' fuer Laender ohne eigenes Bundle (Weltdefault) (ex WORLD-01)", () => {
  assert.equal(languageForCountry("ES"), "en", "ES hat kein eigenes Bundle -> Weltdefault en");
  assert.equal(languageForCountry("JP"), "en", "JP hat kein eigenes Bundle -> Weltdefault en");
  assert.equal(languageForCountry("BR"), "en", "BR hat kein eigenes Bundle -> Weltdefault en");
  assert.equal(languageForCountry(null), "en", "kein Land -> Weltdefault en");
  assert.equal(languageForCountry(""), "en", "leeres Land -> Weltdefault en");
});

test("WORLD-02 (Regressionsachse, gruen) - DE/AT/CH bleiben 'de', FR bleibt 'fr', unabhaengig vom Weltdefault", () => {
  assert.equal(languageForCountry("DE"), "de");
  assert.equal(languageForCountry("AT"), "de");
  assert.equal(languageForCountry("CH"), "de");
  assert.equal(languageForCountry("FR"), "fr");
  assert.equal(localeFor("de").language, "de");
  assert.equal(localeFor("fr").language, "fr");
});

test("languageForCountry('US') liefert 'en' (US-Kunden sprechen Englisch, ueber den Weltdefault) (ex DID-01)", () => {
  assert.equal(languageForCountry("US"), "en");
});

test("WEB-25 (Mechanismus, gruen) - GB/IE sind tabellen-verankert, nicht weltdefault-getragen", () => {
  try {
    setWorldDefaultLanguageEnabled(false);
    assert.equal(languageForCountry("GB"), "en");
    assert.equal(languageForCountry("IE"), "en");
    assert.equal(languageForCountry("US"), "de", "Kontrast: tabellen-fremd folgt dem Weltdefault");
    setWorldDefaultLanguageEnabled(true);
    assert.equal(languageForCountry("GB"), "en");
    assert.equal(languageForCountry("IE"), "en");
    assert.equal(languageForCountry("US"), "en");
  } finally {
    setWorldDefaultLanguageEnabled(true);
  }
});

test("normCountry: striktes ISO-2 (gross), sonst null", () => {
  assert.equal(normCountry("fr"), "FR");
  assert.equal(normCountry(" gb "), "GB");
  assert.equal(normCountry("DEU"), null, "drei Buchstaben -> null");
  assert.equal(normCountry("F1"), null, "Ziffer -> null");
  assert.equal(normCountry(""), null);
  assert.equal(normCountry(null), null);
  assert.equal(normCountry(undefined), null);
});

test("resolveOnboardCountry: User-Wahl ist autoritativ (schlaegt IP-Vorschlag, R4)", () => {
  assert.equal(
    resolveOnboardCountry({ userCountry: "FR", proposedCountry: "DE", fallbackCountry: "DE" }),
    "FR",
    "Override gewinnt gegen gespoofte/abweichende IP",
  );
});

test("resolveOnboardCountry: ohne User-Wahl greift der IP-Vorschlag", () => {
  assert.equal(
    resolveOnboardCountry({ userCountry: null, proposedCountry: "FR", fallbackCountry: "DE" }),
    "FR",
  );
  assert.equal(
    resolveOnboardCountry({ userCountry: "", proposedCountry: "GB", fallbackCountry: "DE" }),
    "GB",
  );
});

test("resolveOnboardCountry: ohne User + ohne IP greift der config-Fallback", () => {
  assert.equal(
    resolveOnboardCountry({ userCountry: null, proposedCountry: null, fallbackCountry: "FR" }),
    "FR",
  );
});

test("resolveOnboardCountry: alles leer -> DEFAULT_COUNTRY (de-Welt: DE)", () => {
  assert.equal(
    resolveOnboardCountry({ userCountry: null, proposedCountry: null, fallbackCountry: "" }),
    DEFAULT_COUNTRY,
  );
  assert.equal(resolveOnboardCountry({}), DEFAULT_COUNTRY);
});

test("resolveOnboardCountry: ungueltige Eingaben fallen fail-safe durch (kein Schreiben von Muell)", () => {
  assert.equal(
    resolveOnboardCountry({ userCountry: "xx!", proposedCountry: "12", fallbackCountry: "FR" }),
    "FR",
  );
});

const TABLE_FOREIGN_FALLBACK_COUNTRY = "ZW";
test("LAW-18 (Mechanismus, gruen) - Total-Ausfall der Geo-Ermittlung: Land = DEFAULT_COUNTRY, Sprache aus der Tabelle", () => {
  const country = resolveOnboardCountry({});
  assert.equal(country, DEFAULT_COUNTRY);
  assert.equal(
    languageForCountry(country),
    languageForCountry(DEFAULT_COUNTRY),
    "die Sprache haengt am aufgeloesten Land, nicht an einer zweiten Regel",
  );
  assert.equal(
    languageForCountry(resolveOnboardCountry({ fallbackCountry: TABLE_FOREIGN_FALLBACK_COUNTRY })),
    DEFAULT_LANGUAGE,
    "erst ein tabellen-fremdes Fallback-Land landet auf dem Weltdefault",
  );
});

test("resolveNumberCountry: forceNumberCountry gewinnt gegen das Herkunftsland", () => {
  assert.equal(resolveNumberCountry("DE", "US"), "US", "Override ueberschreibt Herkunftsland");
  assert.equal(resolveNumberCountry("FR", "US"), "US", "Override gilt unabhaengig vom Herkunftsland");
});

test("resolveNumberCountry: leerer/undefined Override -> Herkunftsland unveraendert (byte-identisch)", () => {
  assert.equal(resolveNumberCountry("DE", ""), "DE");
  assert.equal(resolveNumberCountry("DE", undefined), "DE");
  assert.equal(resolveNumberCountry(null, ""), null, "kein Herkunftsland + kein Override -> null");
});

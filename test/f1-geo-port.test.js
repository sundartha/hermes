// F1 Geo-Location (Phase 6 - Geo-Port + country->language). Netzfreie Unit-Tests:
//   (A) Stub-Adapter: ip->country / unbekannt->null (deterministisch, kein IO)
//   (B) Null-Adapter: loest NIE auf (-> DE-Fallback beim Aufrufer)
//   (C) languageForCountry: DE/AT/CH->de, FR->fr, GB/IE->en, unbekannt/leer->de (R7)
// Der maxmind-Adapter ist heute fail-safe null (kein Reader-Dep, Dep-Regel) -> wir
// pruefen genau diese Invariante (kein Crash, immer null). Die config-getriebene
// Registry-Auswahl deckt der Spawn-Test (f1-geo-onboard) ab; hier kein config-Import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStubGeoLookup, nullGeoLookup } from "../src/geo/stub.js";
import { makeMaxmindGeoLookup } from "../src/geo/maxmind.js";
import { normCountry, resolveOnboardCountry } from "../src/geo/resolve.js";
import { languageForCountry, LANGUAGE_FOR_COUNTRY } from "../src/i18n/locales.js";
import { DEFAULT_LANGUAGE, DEFAULT_COUNTRY } from "../src/store/defaults.js";

// ---- (A) Stub-Adapter ----
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

// ---- (B) Null-Adapter (Default bei GEO_ENABLED aus) ----
test("nullGeoLookup: loest NIE auf -> immer null (DE-Fallback beim Aufrufer)", () => {
  assert.equal(nullGeoLookup("1.2.3.4"), null);
  assert.equal(nullGeoLookup(""), null);
});

// ---- maxmind-Adapter: fail-safe null (Dep-Regel, kein Reader) ----
test("makeMaxmindGeoLookup: ohne Reader/Asset fail-safe null (kein Crash, kein Dep)", () => {
  const withPath = makeMaxmindGeoLookup("/nonexistent/GeoLite2-Country.mmdb");
  const noPath = makeMaxmindGeoLookup("");
  assert.equal(withPath("1.2.3.4"), null);
  assert.equal(noPath("1.2.3.4"), null);
  assert.equal(makeMaxmindGeoLookup()("1.2.3.4"), null, "ohne dbPath-Arg ebenfalls null");
});

// ---- (C) country -> language ----
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

test("languageForCountry: unbekanntes/leeres/null Land -> DEFAULT_LANGUAGE (de, R7)", () => {
  assert.equal(languageForCountry("US"), DEFAULT_LANGUAGE);
  assert.equal(languageForCountry(""), DEFAULT_LANGUAGE);
  assert.equal(languageForCountry(null), DEFAULT_LANGUAGE);
  assert.equal(languageForCountry(undefined), DEFAULT_LANGUAGE);
});

test("LANGUAGE_FOR_COUNTRY ist frozen (eine Quelle, kein Laufzeit-Drift)", () => {
  assert.ok(Object.isFrozen(LANGUAGE_FOR_COUNTRY));
});

// ---- normCountry: strikte ISO-2-Validierung ----
test("normCountry: striktes ISO-2 (gross), sonst null", () => {
  assert.equal(normCountry("fr"), "FR");
  assert.equal(normCountry(" gb "), "GB");
  assert.equal(normCountry("DEU"), null, "drei Buchstaben -> null");
  assert.equal(normCountry("F1"), null, "Ziffer -> null");
  assert.equal(normCountry(""), null);
  assert.equal(normCountry(null), null);
  assert.equal(normCountry(undefined), null);
});

// ---- resolveOnboardCountry: Praezedenz User > IP > Fallback > DEFAULT ----
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
  // ungueltige User-Wahl + ungueltiger Vorschlag -> Fallback
  assert.equal(
    resolveOnboardCountry({ userCountry: "xx!", proposedCountry: "12", fallbackCountry: "FR" }),
    "FR",
  );
});

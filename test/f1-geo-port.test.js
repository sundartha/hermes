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
import { normCountry, resolveOnboardCountry, resolveNumberCountry } from "../src/geo/resolve.js";
import { languageForCountry, LANGUAGE_FOR_COUNTRY, localeFor } from "../src/i18n/locales.js";
import { DEFAULT_COUNTRY, DEFAULT_LANGUAGE } from "../src/store/defaults.js";

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

// LANG-09 (i18n-Testkatalog, tasks/i18n-tests/01-sprachaufloesung.md). Die Case-
// Insensitivitaet gilt auch fuer ein Land OHNE Tabelleneintrag: die Normalisierung
// (String(country||"").toUpperCase()) laeuft VOR dem Nachschlagen, der Fallback ist
// deshalb fuer alle drei Schreibweisen derselbe. Gegen DEFAULT_LANGUAGE formuliert,
// nicht gegen "en" - sonst wird der Test beim naechsten Weltdefault-Flip falsch-rot
// (Baseline 19-w2-baseline.md 1.1). Die Katalog-Aussage "US unveraenderlich de" ist
// seit P10 inhaltlich ueberholt; der gepruefte MECHANISMUS ist unveraendert.
test("LANG-09 (Mechanismus, gruen) - languageForCountry ist auch fuer Tabellen-fremde Laender case-insensitiv", () => {
  assert.equal(languageForCountry("us"), DEFAULT_LANGUAGE);
  assert.equal(languageForCountry("Us"), DEFAULT_LANGUAGE);
  assert.equal(languageForCountry("US"), DEFAULT_LANGUAGE);
});

test("LANGUAGE_FOR_COUNTRY ist frozen (eine Quelle, kein Laufzeit-Drift)", () => {
  assert.ok(Object.isFrozen(LANGUAGE_FOR_COUNTRY));
});

// ---- WORLD-01/WORLD-02 (i18n-Testkatalog, Owner-Entscheidung 7.11/7.12) ----
// Entscheidung: Englisch wird Weltdefault (DEFAULT_LANGUAGE de -> en). Land ohne
// eigenes Bundle (ES/JP/BR/unbekannt) soll kuenftig "en" liefern, nicht "de".
// Beleg: tasks/i18n-tests/00-kanonische-liste.md Abschnitt 4 (Nachtrag 7.12);
// PLAN-I18N-TESTS.md Abschnitt 7.12.
//
// A3-Migration (P10): DEFAULT_LANGUAGE ist geflippt, der Test ist Regressionsschutz.
test("languageForCountry liefert 'en' fuer Laender ohne eigenes Bundle (Weltdefault) (ex WORLD-01)", () => {
  assert.equal(languageForCountry("ES"), "en", "ES hat kein eigenes Bundle -> Weltdefault en");
  assert.equal(languageForCountry("JP"), "en", "JP hat kein eigenes Bundle -> Weltdefault en");
  assert.equal(languageForCountry("BR"), "en", "BR hat kein eigenes Bundle -> Weltdefault en");
  assert.equal(languageForCountry(null), "en", "kein Land -> Weltdefault en");
  assert.equal(languageForCountry(""), "en", "leeres Land -> Weltdefault en");
});

// Regressionsachse (Mechanismus, muss VOR und NACH dem Weltdefault-Wechsel gruen
// bleiben): DE/AT/CH bleiben "de", FR bleibt "fr" - der Weltdefault greift NUR fuer
// Laender ohne eigenen Tabellen-Eintrag, nicht fuer die drei bestehenden Bundles.
test("WORLD-02 (Regressionsachse, gruen) - DE/AT/CH bleiben 'de', FR bleibt 'fr', unabhaengig vom Weltdefault", () => {
  assert.equal(languageForCountry("DE"), "de");
  assert.equal(languageForCountry("AT"), "de");
  assert.equal(languageForCountry("CH"), "de");
  assert.equal(languageForCountry("FR"), "fr");
  assert.equal(localeFor("de").language, "de");
  assert.equal(localeFor("fr").language, "fr");
});

// Beleg: tasks/i18n-tests/06-nummern-provisioning.md ("DID-01"); src/i18n/locales.js:268-280.
// A3-Migration (P10): US ist nicht eigens in LANGUAGE_FOR_COUNTRY eingetragen (bewusst,
// s. WORLD-01/00-kanonische-liste.md Nachtrag 2026-07-25) - der Weltdefault traegt US mit.
test("languageForCountry('US') liefert 'en' (US-Kunden sprechen Englisch, ueber den Weltdefault) (ex DID-01)", () => {
  assert.equal(languageForCountry("US"), "en");
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

// ---- resolveNumberCountry: Kauf-Land-Override (Runde 1, PLAN-VOUCHER-SETUP-FEE-GAP.md) ----
// Regressionstest fuer den Review-Blocker FEE-COUNTRY-DRIFT: numberSetupFeeCentsFor
// (self-service-routes.js) und requestNumberForPaidTenant (provision-trigger.js) muessen
// dieselbe Kombination anwenden - forceNumberCountry gewinnt IMMER gegen das Herkunftsland.
test("resolveNumberCountry: forceNumberCountry gewinnt gegen das Herkunftsland", () => {
  assert.equal(resolveNumberCountry("DE", "US"), "US", "Override ueberschreibt Herkunftsland");
  assert.equal(resolveNumberCountry("FR", "US"), "US", "Override gilt unabhaengig vom Herkunftsland");
});

test("resolveNumberCountry: leerer/undefined Override -> Herkunftsland unveraendert (byte-identisch)", () => {
  assert.equal(resolveNumberCountry("DE", ""), "DE");
  assert.equal(resolveNumberCountry("DE", undefined), "DE");
  assert.equal(resolveNumberCountry(null, ""), null, "kein Herkunftsland + kein Override -> null");
});

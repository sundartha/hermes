import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { callLocaleFor } from "../../src/elevenlabs/call-locale.ts";
import { LANGUAGE_FOR_COUNTRY, SUPPORTED_LANGUAGES, languageForCountry } from "../../src/i18n/locales.ts";
import { anrufStart, nichtLeer } from "../../src/anrufe/start/anrufstart.ts";

const ISO_ANZAHL = 249;
const EIGENE_SPRACHE = { DE: "de", AT: "de", CH: "de", FR: "fr", GB: "en", IE: "en" };
const STAAT_DE = { tenants: [{ id: "t-de", defaultLanguage: "de" }], settings: {} } as unknown as Parameters<typeof callLocaleFor>[0];
const ZUGRIFF = { tenantId: "t-de", numberRecord: null, ownerName: "Jonas Beispiel" };
const BRASILIEN = "+5511912345678";
const BEKANNTE_LAENDER = ["AD", "BR", "DE", "ES", "FR", "GB", "JP", "NZ", "PT", "US", "ZA", "ZW"];

describe("LANGUAGE_FOR_COUNTRY: ein Eintrag je ISO-3166-Alpha-2-Land", () => {
  it("hat alle 249 Laender, jeder Wert ist eine unterstuetzte Sprache oder en", () => {
    const eintraege = Object.entries(LANGUAGE_FOR_COUNTRY);
    assert.equal(eintraege.length, ISO_ANZAHL);
    for (const [land, sprache] of eintraege) {
      assert.match(land, /^[A-Z]{2}$/, land);
      assert.ok(SUPPORTED_LANGUAGES.includes(sprache), `${land}: ${sprache}`);
    }
  });

  it("kennt bekannte Laender und gibt den ueblichen Ausnahmen ihre eigene Sprache", () => {
    for (const land of BEKANNTE_LAENDER) assert.ok(land in LANGUAGE_FOR_COUNTRY, land);
    for (const [land, sprache] of Object.entries(EIGENE_SPRACHE)) assert.equal(LANGUAGE_FOR_COUNTRY[land as keyof typeof LANGUAGE_FOR_COUNTRY], sprache, land);
    for (const land of ["BR", "ES", "JP", "US", "PT"]) assert.equal(LANGUAGE_FOR_COUNTRY[land as keyof typeof LANGUAGE_FOR_COUNTRY], "en", land);
  });

  it("languageForCountry bleibt fuer Laender ohne eigenes Bundle beim Weltstandard", () => {
    assert.equal(languageForCountry("BR"), "en");
    assert.equal(languageForCountry("FR"), "fr");
  });
});

describe("Offenlegung en fuer Ziele ohne eigenen Text", () => {
  it("Startsprache pt und Ziel +55: Offenlegung en, Gespraech auf pt", () => {
    const sprache = callLocaleFor(STAAT_DE, { ...ZUGRIFF, to: BRASILIEN, callLanguage: "pt" });
    assert.equal(sprache.disclosureLanguage, "en");
    assert.equal(sprache.providerLanguage, "pt");
    const start = anrufStart({
      sprachen: { language: sprache.language, providerLanguage: sprache.providerLanguage, disclosureLanguage: sprache.disclosureLanguage, voiceId: sprache.voiceId },
      dritt: "Hello, this is an AI assistant.",
      ownerEroeffnung: "",
      eroeffnungGesagt: false,
      folgesatz: nichtLeer("x"),
    });
    assert.equal(start.offenlegungssprache, "en");
    assert.equal(start.override.agent.language, "pt");
  });

  it("ohne Startsprache und Ziel +55: Offenlegung en statt Sprache des Auftraggebers", () => {
    const sprache = callLocaleFor(STAAT_DE, { ...ZUGRIFF, to: BRASILIEN });
    assert.equal(sprache.disclosureLanguage, "en");
    assert.equal(sprache.language, "de");
  });

  it("Ziel +1 und +81 ohne Startsprache: Offenlegung en", () => {
    assert.equal(callLocaleFor(STAAT_DE, { ...ZUGRIFF, to: "+15125550143" }).disclosureLanguage, "en");
    assert.equal(callLocaleFor(STAAT_DE, { ...ZUGRIFF, to: "+819012345678" }).disclosureLanguage, "en");
  });

  it("ohne brauchbares Ziel folgt die Offenlegung weiter dem Auftraggeber", () => {
    for (const to of [null, "keine"]) assert.equal(callLocaleFor(STAAT_DE, { ...ZUGRIFF, to }).disclosureLanguage, "de", String(to));
  });

  it("Eingehender Anruf mit fremder Startsprache: Offenlegung en", () => {
    assert.equal(callLocaleFor(STAAT_DE, { ...ZUGRIFF, to: null, callLanguage: "pt" }).disclosureLanguage, "en");
  });

  it("Ziel in DE mit fremder Startsprache: Offenlegung in der Sprache des Angerufenen", () => {
    assert.equal(callLocaleFor(STAAT_DE, { ...ZUGRIFF, to: "+4915123456789", callLanguage: "pt" }).disclosureLanguage, "de");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LANGUAGE_FOR_COUNTRY, SUPPORTED_LANGUAGES, disclosurePrefixFor, languageForCountry } from "../../src/i18n/locales.ts";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { TELNYX_TEST_OWNER_NUMBER, seedState, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { initInhaltFuer } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const ISO_ANZAHL = 249;
const EIGENE_SPRACHE = new Map([["DE", "de"], ["AT", "de"], ["CH", "de"], ["FR", "fr"], ["GB", "en"], ["IE", "en"]]);
const BEKANNTE_LAENDER = ["AD", "BR", "DE", "ES", "FR", "GB", "JP", "NZ", "PT", "US", "ZA", "ZW"];
const BRASILIEN = "+5511912345678";
const USA = "+15125550143";
const JAPAN = "+819012345678";
const DEUTSCHLAND = "+4915123456789";
const OBJECTIVE = "Termin vereinbaren (6183)";

const VORSPANN_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  ELEVENLABS_RESULT_POLL_MS: "150",
});

async function mitServer(lauf) {
  const srv = await startServer({
    env: { ...VORSPANN_ENV },
    seed: seedState({ settings: { language: "de" }, tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }] }),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    await lauf(srv);
  } finally {
    await srv.stop();
  }
}

async function anrufInhalt(srv, to, language) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: OBJECTIVE, ...(language === undefined ? {} : { language }) }),
  });
  const antwort = await res.text();
  assert.equal(res.status, HTTP_OK, antwort);
  return initInhaltFuer(srv, { callId: JSON.parse(antwort).callId });
}

describe("LANGUAGE_FOR_COUNTRY: ein Eintrag je ISO-3166-Alpha-2-Land", () => {
  it("hat alle 249 Laender, jeder Wert ist eine unterstuetzte Sprache", () => {
    const eintraege = Object.entries(LANGUAGE_FOR_COUNTRY);
    assert.equal(eintraege.length, ISO_ANZAHL);
    for (const [land, sprache] of eintraege) {
      assert.match(land, /^[A-Z]{2}$/, land);
      assert.ok(SUPPORTED_LANGUAGES.includes(sprache), `${land}: ${sprache}`);
    }
  });

  it("kennt bekannte Laender, die sechs Ausnahmen haben ihre Sprache, alle anderen en", () => {
    const tabelle = new Map(Object.entries(LANGUAGE_FOR_COUNTRY));
    for (const land of BEKANNTE_LAENDER) assert.ok(tabelle.has(land), land);
    for (const [land, sprache] of tabelle) assert.equal(sprache, EIGENE_SPRACHE.get(land) ?? "en", land);
  });

  it("languageForCountry bleibt fuer Laender ohne eigenes Bundle beim Weltstandard", () => {
    assert.equal(languageForCountry("BR"), "en");
    assert.equal(languageForCountry("fr"), "fr");
    assert.equal(languageForCountry(undefined), "en");
  });
});

describe("Offenlegung en fuer Ziele ohne eigenen Text, ueber POST /api/calls", () => {
  it("Startsprache pt und Ziel +55: Offenlegung en, Gespraech auf pt", async () => {
    await mitServer(async (srv) => {
      const inhalt = await anrufInhalt(srv, BRASILIEN, "pt");
      assert.equal(inhalt.conversation_config_override.agent.language, "pt");
      assert.ok(inhalt.dynamic_variables.eroeffnung_gesagt.startsWith(disclosurePrefixFor("en")));
    });
  });

  it("ohne Startsprache und Ziel +55: Offenlegung en, Gespraech in der Sprache des Auftraggebers", async () => {
    await mitServer(async (srv) => {
      const inhalt = await anrufInhalt(srv, BRASILIEN);
      assert.equal(inhalt.conversation_config_override.agent.language, "de");
      assert.ok(inhalt.dynamic_variables.eroeffnung_gesagt.startsWith(disclosurePrefixFor("en")));
    });
  });

  it("Ziel +1 und +81 ohne Startsprache: Offenlegung en", async () => {
    await mitServer(async (srv) => {
      for (const ziel of [USA, JAPAN]) {
        const inhalt = await anrufInhalt(srv, ziel);
        assert.ok(inhalt.dynamic_variables.eroeffnung_gesagt.startsWith(disclosurePrefixFor("en")), ziel);
      }
    });
  });

  it("Ziel in DE mit Startsprache pt: Offenlegung in der Sprache des Angerufenen", async () => {
    await mitServer(async (srv) => {
      const inhalt = await anrufInhalt(srv, DEUTSCHLAND, "pt");
      assert.equal(inhalt.conversation_config_override.agent.language, "pt");
      assert.ok(inhalt.dynamic_variables.eroeffnung_gesagt.startsWith(disclosurePrefixFor("de")));
    });
  });
});

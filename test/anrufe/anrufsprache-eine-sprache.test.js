import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { disclosurePrefixFor } from "../../src/i18n/locales.ts";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { TELNYX_TEST_OWNER_NUMBER, TELNYX_TEST_PEER_NUMBER, seedState, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { initInhaltFuer } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const OBJECTIVE = "Termin vereinbaren (eine Sprache)";
const FR_ZIEL = "+33612345678";
const PT_ZIEL = "+351912345678";

const VORSPANN_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  ELEVENLABS_RESULT_POLL_MS: "150",
});

async function startInhalt({ to, language, mandantSprache = "de" }) {
  const srv = await startServer({
    env: { ...VORSPANN_ENV },
    seed: seedState({ settings: { language: mandantSprache }, tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }] }),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, objective: OBJECTIVE, ...(language === undefined ? {} : { language }) }),
    });
    const antwort = await res.text();
    assert.equal(res.status, HTTP_OK, antwort);
    return await initInhaltFuer(srv, { callId: JSON.parse(antwort).callId });
  } finally {
    await srv.stop();
  }
}

const KI_HINWEIS = Object.freeze({ de: /KI-Assistent/, fr: /assistant IA/, en: /AI assistant/ });

const gesagt = (inhalt) => inhalt.dynamic_variables.eroeffnung_gesagt;

describe("eine Sprache je Anruf: Offenlegung und Gespraech folgen der Anrufsprache, nicht dem Land der Nummer", () => {
  const UNTERSTUETZT = [
    { name: "fr an eine +49-Nummer", language: "fr", to: TELNYX_TEST_PEER_NUMBER },
    { name: "en an eine +49-Nummer", language: "en", to: TELNYX_TEST_PEER_NUMBER },
    { name: "en an eine +33-Nummer", language: "en", to: FR_ZIEL },
    { name: "fr-CA an eine +49-Nummer", language: "fr-CA", to: TELNYX_TEST_PEER_NUMBER, erwartet: "fr" },
  ];
  for (const fall of UNTERSTUETZT)
    it(`${fall.name}: Pflichtsatz und agent.language in der Anrufsprache`, async () => {
      const inhalt = await startInhalt(fall);
      const sprache = fall.erwartet ?? fall.language;
      assert.equal(inhalt.conversation_config_override.agent.language, sprache);
      assert.match(gesagt(inhalt), KI_HINWEIS[sprache], JSON.stringify(gesagt(inhalt)));
    });

  const OHNE_TEXT = [
    { name: "pt an eine +49-Nummer", language: "pt", erwartet: "pt" },
    { name: "ar an eine +49-Nummer", language: "ar", erwartet: "ar" },
    { name: "ja an eine +49-Nummer", language: "ja", erwartet: "ja" },
  ];
  for (const fall of OHNE_TEXT)
    it(`${fall.name}: der Anbieter bekommt die Anrufsprache, der Pflichtsatz kommt einmal auf Englisch, nie auf Deutsch`, async () => {
      const inhalt = await startInhalt({ to: TELNYX_TEST_PEER_NUMBER, language: fall.language });
      assert.equal(inhalt.conversation_config_override.agent.language, fall.erwartet);
      assert.ok(gesagt(inhalt).startsWith(disclosurePrefixFor("en")), JSON.stringify(gesagt(inhalt)));
    });

  it("pt-BR an eine +49-Nummer: der Anbieter bekommt den primaeren Sprachcode pt", async () => {
    const inhalt = await startInhalt({ to: TELNYX_TEST_PEER_NUMBER, language: "pt-BR" });
    assert.equal(inhalt.conversation_config_override.agent.language, "pt");
  });

  const AUSDRUECKLICH_DE = [
    { name: "de an eine +351-Nummer bei Mandantensprache en", to: PT_ZIEL, mandantSprache: "en" },
    { name: "de an eine +33-Nummer bei Mandantensprache en", to: FR_ZIEL, mandantSprache: "en" },
  ];
  for (const fall of AUSDRUECKLICH_DE)
    it(`${fall.name}: Pflichtsatz und agent.language auf de`, async () => {
      const inhalt = await startInhalt({ ...fall, language: "de" });
      assert.equal(inhalt.conversation_config_override.agent.language, "de");
      assert.match(gesagt(inhalt), KI_HINWEIS.de, JSON.stringify(gesagt(inhalt)));
    });

  it("ohne Anrufsprache bleibt die Landessprache der Nummer fuer die Offenlegung", async () => {
    const inhalt = await startInhalt({ to: FR_ZIEL });
    assert.ok(gesagt(inhalt).startsWith(disclosurePrefixFor("fr")));
    assert.equal(inhalt.conversation_config_override.agent.language, "de");
  });
});

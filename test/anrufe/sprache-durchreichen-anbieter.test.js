import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { TELNYX_TEST_OWNER_NUMBER, TELNYX_TEST_PEER_NUMBER, seedState, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { initInhaltFuer } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;

const VORSPANN_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  ELEVENLABS_RESULT_POLL_MS: "150",
  WORLD_DEFAULT_LANGUAGE_ENABLED: "false",
});

async function anbieterSpracheFuer(language) {
  const srv = await startServer({
    env: VORSPANN_ENV,
    seed: seedState({ settings: { language: "de" }, tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }] }),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective: `Termin vereinbaren ${language}`, language }),
    });
    const antwort = await res.text();
    assert.equal(res.status, HTTP_OK, antwort);
    const inhalt = await initInhaltFuer(srv, { callId: JSON.parse(antwort).callId });
    return inhalt.conversation_config_override.agent.language;
  } finally {
    await srv.stop();
  }
}

describe("agent.language im Override reicht die angefragte Startsprache durch", () => {
  it("DA-1: language 'pt-br' wird zu agent.language 'pt' normalisiert", async () => {
    assert.equal(await anbieterSpracheFuer("pt-br"), "pt");
  });

  it("DA-2: language 'it' kommt ohne eigene Texte trotzdem unveraendert beim Anbieter an", async () => {
    assert.equal(await anbieterSpracheFuer("it"), "it");
  });

  it("DA-3: language 'nl' kommt ohne eigene Texte trotzdem unveraendert beim Anbieter an", async () => {
    assert.equal(await anbieterSpracheFuer("nl"), "nl");
  });

  it("DA-4: language 'de' bleibt unveraendert de", async () => {
    assert.equal(await anbieterSpracheFuer("de"), "de");
  });

  it("DA-5: language 'zh' (formgueltig) kommt unveraendert beim Anbieter an", async () => {
    assert.equal(await anbieterSpracheFuer("zh"), "zh");
  });

  it("DA-6 (Verhaltensaenderung gegenueber SF-4): language 'es' wird jetzt durchgereicht statt auf en zu fallen", async () => {
    assert.equal(await anbieterSpracheFuer("es"), "es");
  });
});

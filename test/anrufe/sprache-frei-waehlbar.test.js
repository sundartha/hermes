import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { TELNYX_TEST_OWNER_NUMBER, TELNYX_TEST_PEER_NUMBER, seedState, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { initInhaltFuer } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;

const VORSPANN_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  ELEVENLABS_RESULT_POLL_MS: "150",
});

async function mitServer(env, run) {
  const srv = await startServer({
    env: { ...VORSPANN_ENV, ...env },
    seed: seedState({ settings: { language: "de" }, tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }] }),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    return await run(srv);
  } finally {
    await srv.stop();
  }
}

const placeCall = (srv, language) =>
  abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective: `Termin vereinbaren ${language}`, language }),
  });

const outboundCalls = (srv) => srv.readStore().calls.filter((call) => call.direction === "outbound");

describe("Startsprache frei waehlbar ueber POST /api/calls", () => {
  it("SF-1: language 'es' wird angenommen und der Anruf traegt es", async () => {
    await mitServer({}, async (srv) => {
      const res = await placeCall(srv, "es");
      assert.equal(res.status, HTTP_OK, await res.clone().text());
      assert.equal(outboundCalls(srv)[0].language, "es");
    });
  });

  const normalisiert = async (eingabe, code) => {
    await mitServer({}, async (srv) => {
      const res = await placeCall(srv, eingabe);
      assert.equal(res.status, HTTP_OK, await res.clone().text());
      assert.equal(outboundCalls(srv)[0].language, code);
    });
  };

  it("SF-2a: 'ES' wird zu es", () => normalisiert("ES", "es"));
  it("SF-2b: ' es ' wird zu es", () => normalisiert(" es ", "es"));
  it("SF-2c: 'pt-BR' wird zu pt-br", () => normalisiert("pt-BR", "pt-br"));

  it("SF-3: Formfehler ergeben 400 invalid_language, keinen Datensatz und keine Wahl", async () => {
    await mitServer({}, async (srv) => {
      for (const code of ["zz9", "x", "deutsch bitte", "de_DE!", "de-", "abcd", "en-x"]) {
        const res = await placeCall(srv, code);
        assert.equal(res.status, HTTP_BAD_REQUEST, code);
        const json = await res.json();
        assert.equal(json.code, "invalid_language", code);
        assert.equal(json.supported, undefined);
      }
      assert.equal(outboundCalls(srv).length, 0);
      const wahlen = srv.vorspannAttrappe.pfade.filter((pfad) => pfad === "/v2/calls");
      assert.equal(wahlen.length, 0);
    });
  });

  it("SF-3c: eine Zahl als language ist ein Formfehler", async () => {
    await mitServer({}, async (srv) => {
      const res = await placeCall(srv, 42);
      assert.equal(res.status, HTTP_BAD_REQUEST);
      assert.equal((await res.json()).code, "invalid_language");
    });
  });

  it("SF-3b: Grenzen der Form, 3 Buchstaben und 8 Zeichen Region gelten", async () => {
    await mitServer({}, async (srv) => {
      for (const code of ["fil", "zh-hans123", "en-ab"]) {
        const res = await placeCall(srv, code);
        assert.equal(res.status, HTTP_OK, code);
      }
      const zuLang = await placeCall(srv, "zh-hans12345");
      assert.equal(zuLang.status, HTTP_BAD_REQUEST);
    });
  });

  it("SF-4: Startsprache ohne eigene Texte (es) nutzt Englisch, auch wenn die Standardsprache de ist", async () => {
    await mitServer({ WORLD_DEFAULT_LANGUAGE_ENABLED: "false" }, async (srv) => {
      const res = await placeCall(srv, "es");
      const antwort = await res.text();
      assert.equal(res.status, HTTP_OK, antwort);
      const inhalt = await initInhaltFuer(srv, { callId: JSON.parse(antwort).callId });
      assert.equal(inhalt.conversation_config_override.agent.language, "en");
    });
  });

  it("SF-4b: de bleibt Deutsch bei Standardsprache de", async () => {
    await mitServer({ WORLD_DEFAULT_LANGUAGE_ENABLED: "false" }, async (srv) => {
      const res = await placeCall(srv, "de");
      const antwort = await res.text();
      const inhalt = await initInhaltFuer(srv, { callId: JSON.parse(antwort).callId });
      assert.equal(inhalt.conversation_config_override.agent.language, "de");
    });
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { TELNYX_TEST_OWNER_NUMBER, TELNYX_TEST_PEER_NUMBER, seedState, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { initInhaltFuer } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;

const OBJECTIVE = "Termin vereinbaren (P4a)";

const VORSPANN_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  ELEVENLABS_RESULT_POLL_MS: "150",
});

function seedOwnerDe() {
  return seedState({
    settings: { language: "de" },
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }],
  });
}

async function withVorspann(run) {
  const srv = await startServer({
    env: { ...VORSPANN_ENV },
    seed: seedOwnerDe(),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    return await run({ srv });
  } finally {
    await srv.stop();
  }
}

function placeCall(srv, { to = TELNYX_TEST_PEER_NUMBER, language } = {}) {
  return abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: OBJECTIVE, ...(language === undefined ? {} : { language }) }),
  });
}

async function vorspannInit(srv, optionen) {
  const res = await placeCall(srv, optionen);
  const antwort = await res.text();
  assert.equal(res.status, HTTP_OK, antwort);
  return initInhaltFuer(srv, { callId: JSON.parse(antwort).callId });
}

const EINE_STIMME = "cqPdIo76zSHFDcSZpFov";

const stimmeDesAnrufs = async (srv, optionen) => {
  const inhalt = await vorspannInit(srv, optionen);
  return inhalt.conversation_config_override.tts.voice_id;
};

test("5986-H1: Anruf ohne Sprache startet mit der einen Stimme", async () => {
  await withVorspann(async ({ srv }) => {
    assert.equal(await stimmeDesAnrufs(srv, {}), EINE_STIMME);
  });
});

test("5986-H1: Anruf auf Franzoesisch startet mit derselben einen Stimme", async () => {
  await withVorspann(async ({ srv }) => {
    assert.equal(await stimmeDesAnrufs(srv, { language: "fr" }), EINE_STIMME);
  });
});

test("5986-H1: Anruf auf Englisch startet mit derselben einen Stimme", async () => {
  await withVorspann(async ({ srv }) => {
    assert.equal(await stimmeDesAnrufs(srv, { language: "en" }), EINE_STIMME);
  });
});

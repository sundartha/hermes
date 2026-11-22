import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { TELNYX_TEST_OWNER_NUMBER, TELNYX_TEST_PEER_NUMBER, seedState, startServer } from "../helpers.js";
import { stdioSnapshot } from "../mcp-draht-pfade.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { initInhaltFuer } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const OBJECTIVE = "Termin vereinbaren (5986-H3)";

const VORSPANN_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  ELEVENLABS_RESULT_POLL_MS: "150",
});

const seedGespeichertFr = () =>
  seedState({
    settings: { language: "fr" },
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", defaultLanguage: "fr" }],
  });

async function mitServer(run) {
  const srv = await startServer({
    env: { ...VORSPANN_ENV },
    seed: seedGespeichertFr(),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    return await run(srv);
  } finally {
    await srv.stop();
  }
}

const anrufen = (srv, extra) =>
  abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective: OBJECTIVE, ...extra }),
  });

async function startsprache(srv, extra) {
  const res = await anrufen(srv, extra);
  const antwort = await res.text();
  assert.equal(res.status, HTTP_OK, antwort);
  const inhalt = await initInhaltFuer(srv, { callId: JSON.parse(antwort).callId });
  return inhalt.conversation_config_override.agent.language;
}

test("5986-H3: Anruf ohne language startet auf de, auch wenn Einstellung und Mandant fr gespeichert haben", async () => {
  await mitServer(async (srv) => {
    assert.equal(await startsprache(srv, {}), "de");
  });
});

test("5986-H3: Anruf mit language fr startet auf fr", async () => {
  await mitServer(async (srv) => {
    assert.equal(await startsprache(srv, { language: "fr" }), "fr");
  });
});

test("5986-H3: Anruf mit language en startet auf en", async () => {
  await mitServer(async (srv) => {
    assert.equal(await startsprache(srv, { language: "en" }), "en");
  });
});

test("5986-H3: place_call beschreibt language mit Standard de und Sprachwechsel im Gespraech", async () => {
  const { tools } = await stdioSnapshot({});
  const { properties } = tools.find((werkzeug) => werkzeug.name === "place_call").inputSchema;
  const beschreibung = properties.language.description;
  assert.match(beschreibung, /Default: de\./);
  assert.match(beschreibung, /switch language/);
});

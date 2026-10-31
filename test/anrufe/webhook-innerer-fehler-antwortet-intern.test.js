import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_SERVER_ERROR = 500;
const INNERER_FEHLER_TEXT = "intern";

const CONSULT_PATH = "/webhooks/elevenlabs/consult";
const LOOKUP_PATH = "/webhooks/elevenlabs/lookup";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const TOOL_TOKEN = "el-fehlertext-token-testgeheim";

const CALL_ID = "call_el_fehlertext";
const CONVERSATION_ID = "conv_el_fehlertext_1";
const QUESTION = "Darf ich den Termin am Donnerstag zusagen?";
const QUERY = "opening hours Grove Street Auto Repair Portland";

const MAX_DURATION_S = 300;
const ANSWERED_AGO_MS = 5000;

const WEBHOOK_ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  LOOKUP_ENABLED: "true",
  EXA_API_KEY: "exa-test-key",
  ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
  SKIP_TWILIO_SIGNATURE_CHECK: "false",
  MULTI_TENANT: "true",
});

const laufenderAnrufMitDefekt = (defekt) =>
  seedState({
    calls: [
      seedCall({
        id: CALL_ID,
        status: "active",
        direction: "outbound",
        maxDurationS: MAX_DURATION_S,
        answeredAt: new Date(Date.now() - ANSWERED_AGO_MS).toISOString(),
        elevenlabsConversationId: CONVERSATION_ID,
        ...defekt,
      }),
    ],
  });

const post = (srv, pfad, body) =>
  abrufMitFrist(`${srv.localUrl}${pfad}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [TOOL_TOKEN_HEADER]: TOOL_TOKEN },
    body: JSON.stringify({ conversation_id: CONVERSATION_ID, ...body }),
  });

test("Konsultations-Webhook antwortet bei innerem Fehler mit 500 und { error: intern }", async () => {
  const srv = await startServer({
    env: WEBHOOK_ENV,
    seed: laufenderAnrufMitDefekt({ consults: {} }),
  });
  try {
    const res = await post(srv, CONSULT_PATH, { question: QUESTION });
    assert.equal(res.status, HTTP_SERVER_ERROR);
    assert.deepEqual(await res.json(), { error: INNERER_FEHLER_TEXT });
  } finally {
    await srv.stop();
  }
});

test("Recherche-Webhook antwortet bei innerem Fehler mit 500 und { error: intern }", async () => {
  const srv = await startServer({
    env: WEBHOOK_ENV,
    seed: laufenderAnrufMitDefekt({ lookupLog: {} }),
  });
  try {
    const res = await post(srv, LOOKUP_PATH, { query: QUERY });
    assert.equal(res.status, HTTP_SERVER_ERROR);
    assert.deepEqual(await res.json(), { error: INNERER_FEHLER_TEXT });
  } finally {
    await srv.stop();
  }
});

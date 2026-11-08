import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";

const FRIST_MS = 20000;
const POLL_TAKT_MS = 600000;
const MAX_DAUER_S = 2;
const MS_PRO_S = 1000;
const TENANT = "t_3491_max";
const PROVIDER_SUMMARY = "The assistant asked about prices and ended the call.";
const MODEL_SUMMARY = "Preis fuer 5 l Olivenoel erfragt: 64,50 Euro.";

const conversationOf = (status) => ({
  conversation_id: "conv_max",
  status,
  transcript: [
    { role: "agent", message: "Preis fuer 5 l Olivenoel?" },
    { role: "user", message: "Preis genannt: 64,50 Euro" },
  ],
  analysis: { call_successful: "failure", transcript_summary: PROVIDER_SUMMARY },
  metadata: { call_duration_secs: 2, phone_call: { direction: "outbound", call_id: "otb_max" } },
});

const modelReply = (text) => ({
  id: "msg_3491_max",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 20, output_tokens: 30 },
});

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((bereit) => server.listen(0, "127.0.0.1", () => bereit(server)));
}

let model;
let elevenLabs;
let srv;
let stand;
const angerufenAbMs = Date.now();

before(async () => {
  model = await listen((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      const antwort = { summary: MODEL_SUMMARY, actionItems: [], objective_achieved: true };
      res.end(JSON.stringify(modelReply(JSON.stringify(antwort))));
    });
  });
  elevenLabs = await listen((req, res) => {
    res.setHeader("content-type", "application/json");
    const beendet = Date.now() >= angerufenAbMs + MAX_DAUER_S * MS_PRO_S;
    res.end(JSON.stringify(conversationOf(beendet ? "done" : "processing")));
  });
  srv = await startServer({
    env: {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${model.address().port}`,
      ANTHROPIC_API_KEY: "test-3491-key",
      ELEVENLABS_API_BASE: `http://127.0.0.1:${elevenLabs.address().port}`,
      ELEVENLABS_API_KEY: "test-key",
      ELEVENLABS_RESULT_POLL_MS: String(POLL_TAKT_MS),
    },
    seed: seedState({
      tenants: [{ id: TENANT, status: "active", ownerName: "Jonas Beispiel" }],
      calls: [
        seedCall({
          id: "call_3491_max",
          tenantId: TENANT,
          costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
          goal: "Preis fuer 5 l Olivenoel erfragen",
          elevenlabsConversationId: "conv_max",
          answeredAt: new Date().toISOString(),
          maxDurationS: MAX_DAUER_S,
        }),
      ],
    }),
  });
  stand = await waitForStoreState(srv, (s) => s.calls.every((c) => c.billedAt), FRIST_MS);
});

after(async () => {
  await srv.stop();
  await new Promise((r) => model.close(r));
  await new Promise((r) => elevenLabs.close(r));
});

test("Max-Dauer beendet den Anruf: Ziel wird gegen den Auftrag bewertet statt unclear zu bleiben", () => {
  const call = stand.calls.find((c) => c.id === "call_3491_max");
  assert.equal(call.status, "completed");
  assert.equal(call.objectiveAchieved, true);
  assert.equal(call.summary, MODEL_SUMMARY);
});

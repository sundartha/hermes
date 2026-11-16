import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { tempDataDir, seedState, seedCall, voiceAttrappenOhneSignatur } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitRoutenServer } from "./routen-server.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { MAX_TOOL_ROUNDS_PER_TURN } from "../../src/turn-budget.ts";

const CALLER_TEXT = "Ja, Donnerstag passt gut";
const FIRST_ROUND_MS = 1000;
const REFRESH_MS = 1500;

const usage = { input_tokens: 10, output_tokens: 5 };
const toolRound = () => ({
  id: "msg_rfa",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  content: [{ type: "tool_use", id: "tu1", name: "look_up_not_yet_built", input: {} }],
  stop_reason: "tool_use",
  stop_sequence: null,
  usage,
});

let server;
let bodies = 0;
let store, makeVoiceRoutes, webhookEvents, withConfigNamespaces;

before(async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      bodies += 1;
      mock.timers.tick(FIRST_ROUND_MS);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(toolRound()));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-rfa-key";
  process.env.ELEVENLABS_SYNTH_TIMEOUT_MS = "10000";
  process.env.LLM_REQUEST_TIMEOUT_MS = "2000";
  process.env.LLM_MAX_RETRIES = "2";
  process.env.LLM_BACKOFF_MS = "1";
  process.env.MAX_BUDGET_EUR = "30";
  process.env.DEFAULT_TENANT_BUDGET_CENTS = "1500";
  process.env.PAYMENT_ENABLED = "false";
  process.env.BUDGET_MONTH_ENABLED = "false";
  process.env.VOICE_TARIFF_DEFAULT_CENTS = "0";
  process.env.VOICE_TARIFF_DOMESTIC_CENTS = "0";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
      calls: [seedCall({ id: "call_rfa_1", direction: "outbound", language: "de", provider: "telnyx", status: "active" })],
    }),
  );
  await import("../../src/config.js");
  store = await import("../../src/store.js");
  ({ makeVoiceRoutes } = await import("../../src/routes/voice.js"));
  ({ webhookEvents } = await import("../../src/telephony/registry.js"));
  ({ withConfigNamespaces } = await import("../config-namespaces-helper.js"));
});

after(async () => {
  mock.timers.reset();
  await new Promise((r) => server.close(r));
});

async function langsameAuffrischung(tenantId) {
  if (bodies >= 1) mock.timers.tick(REFRESH_MS);
  return store.nutzungAuffrischen(tenantId);
}

function voiceRouter() {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));
  router.use(
    makeVoiceRoutes({
      ...voiceAttrappenOhneSignatur(),
      store: { ...store, nutzungAuffrischen: langsameAuffrischung },
      config: withConfigNamespaces({ multiTenant: false, skipTwilioSignatureCheck: true }),
      lifecycle: { reattachActiveCall: async () => ({ call: null }), armMaxDurationTimer: () => {} },
      finishCall: async () => {},
      webhookEvents,
      terminateAndBillCall: async () => {},
      billThunk: () => () => {},
      startInboundNachlauf: () => {},
    }),
  );
  return router;
}

test("RFA-1: die Zeit der langsamen Auffrischung zaehlt zur Rundenfrist", async () => {
  bodies = 0;
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    await mitRoutenServer(voiceRouter(), (url) =>
      abrufMitFrist(`${url}/voice/turn?callId=call_rfa_1`, {
        method: "POST",
        body: new URLSearchParams({ SpeechResult: CALLER_TEXT }),
      }),
    );
  } finally {
    console.warn = original;
  }

  assert.equal(bodies, 1, "Runde 2 wird nicht mehr gestartet");
  assert.ok(bodies < MAX_TOOL_ROUNDS_PER_TURN);
  assert.ok(lines.some((l) => /\[turn\] abbruch grund=deadline call=call_rfa_1 runden=1/.test(l)), JSON.stringify(lines));
});

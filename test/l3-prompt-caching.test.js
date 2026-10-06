import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const CALL_ID = "call_l3";
const EPHEMERAL = { type: "ephemeral" };

let nextUsage = { input_tokens: 10, output_tokens: 5 };

function anthropicMessage() {
  return {
    id: "msg_l3_mock",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text: "Alles klar." }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: nextUsage,
  };
}

let server;
let lastBody = null;
let systemPrompt, toolDefs, agentTurn, store;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      lastBody = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(anthropicMessage()));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-l3-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [seedCall({ id: CALL_ID, direction: "outbound", goal: "Termin verschieben" })],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ systemPrompt, toolDefs, agentTurn } = await import("../src/claude.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test("T-L3-1 Request-Form System: 1-Element-text-Block mit cache_control, Inhalt byte-identisch", async () => {
  const call = store.getCall(CALL_ID);
  nextUsage = { input_tokens: 10, output_tokens: 5 };
  await agentTurn(call, "Passt Freitag?");

  assert.ok(Array.isArray(lastBody.system), "system muss ein Content-Block-Array sein");
  assert.equal(lastBody.system.length, 1, "genau ein System-Block");
  assert.equal(lastBody.system[0].type, "text", "System-Block ist ein text-Block");
  assert.equal(lastBody.system[0].text, systemPrompt(call), "System-Inhalt muss byte-identisch sein");
  assert.deepEqual(lastBody.system[0].cache_control, EPHEMERAL, "System-Block traegt cache_control");
});

test("T-L3-2 Request-Form Tools: nur der letzte Tool traegt cache_control, Inhalt byte-identisch", async () => {
  const call = store.getCall(CALL_ID);
  const defs = toolDefs(BOOTSTRAP_TENANT_ID);
  nextUsage = { input_tokens: 10, output_tokens: 5 };
  await agentTurn(call, "Und Samstag?");

  assert.equal(lastBody.tools.length, defs.length, "Tool-Anzahl unveraendert");
  const last = lastBody.tools.length - 1;
  for (let i = 0; i < last; i++) {
    assert.equal(lastBody.tools[i].cache_control, undefined, `Tool ${i} darf kein cache_control tragen`);
  }
  assert.deepEqual(lastBody.tools[last].cache_control, EPHEMERAL, "letzter Tool traegt cache_control");
  const { cache_control, ...withoutMarker } = lastBody.tools[last];
  assert.deepEqual(
    withoutMarker,
    { name: defs[last].name, description: defs[last].description, input_schema: defs[last].parameters },
    "Tool-Inhalt (ohne cache_control) byte-identisch",
  );
});

test("T-L3-3 Metering zaehlt Cache-Token (Budget-Gate, Regel 1)", async () => {
  const call = store.getCall(CALL_ID);
  nextUsage = {
    input_tokens: 5,
    output_tokens: 7,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 100,
  };
  const before = store.usageOf(BOOTSTRAP_TENANT_ID);
  const beforeInput = before.inputTokens;
  const beforeOutput = before.outputTokens;

  await agentTurn(call, "Buchen Sie bitte.");

  const after = store.usageOf(BOOTSTRAP_TENANT_ID);
  assert.equal(after.inputTokens - beforeInput, 125, "Budget zaehlt den vollen Input inkl. Cache");
  assert.equal(after.outputTokens - beforeOutput, 7, "Output-Token unveraendert gezaehlt");
});

test("T-L3-4 ohne Cache-Felder byte-identisch zum Bestand (|| 0-Fallback)", async () => {
  const call = store.getCall(CALL_ID);
  nextUsage = { input_tokens: 5, output_tokens: 7 };
  const beforeInput = store.usageOf(BOOTSTRAP_TENANT_ID).inputTokens;

  await agentTurn(call, "Danke.");

  const afterInput = store.usageOf(BOOTSTRAP_TENANT_ID).inputTokens;
  assert.equal(afterInput - beforeInput, 5, "ohne Cache-Felder zaehlt genau input_tokens");
});

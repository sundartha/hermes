import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TOOL_COUNT_WITH_CONSULT } from "../helpers.js";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-secret-do-not-leak";
process.env.TELNYX_CONNECTION_ID = "conn_law21";
process.env.TELNYX_ACCOUNT_SID = "acct_law21";
process.env.FAKE_ORIGINATE = "false";

const { registerTools } = await import("../../src/mcp-tools.js");
const { voiceControl } = await import("../../src/telephony/registry.js");

const AUDIO_NAME = /audio|recording|base64/i;
const RECORDING = /record/i;
const CALL_ID = "call_law21";
const TO = "+4930123456";
const STARTED_AT = "2026-10-16T10:00:00.000Z";
const AUDIO_FROM_GATEWAY = {
  audioUrl: "https://gateway.test/a.mp3",
  recordingUrl: "https://gateway.test/r.wav",
  audioBase64: "QUJD",
  recording: { url: "https://gateway.test/r.wav" },
};
const CALL_ROW = { id: CALL_ID, direction: "outbound", status: "completed", to: TO, startedAt: STARTED_AT, ...AUDIO_FROM_GATEWAY };
const INBOUND_ROW = {
  id: "call_law21_in",
  direction: "inbound",
  status: "active",
  from: TO,
  startedAt: STARTED_AT,
  answeredAt: STARTED_AT,
  summary: "Rueckruf erbeten",
  ...AUDIO_FROM_GATEWAY,
};
const GATEWAY_BODY = {
  ...CALL_ROW,
  callId: CALL_ID,
  confirmed: true,
  event: "done",
  preview: { status: "preview", to: TO, objective: "Termin" },
  transcript: [{ role: "agent", text: "Hallo", ...AUDIO_FROM_GATEWAY }],
  agent: { number: TO, ...AUDIO_FROM_GATEWAY },
  calls: [CALL_ROW, INBOUND_ROW],
  entries: [],
  remaining: 0,
  actionItems: [{ text: "Rueckruf", ...AUDIO_FROM_GATEWAY }],
  usage: { calls: 1, ...AUDIO_FROM_GATEWAY },
  settings: { allowSummaries: true, ...AUDIO_FROM_GATEWAY },
};
const CANCEL_BODY = { status: "cancelled" };
const TOOL_ARGS = {
  prepare_call: { to: TO, objective: "Termin" },
  place_call: { to: TO, objective: "Termin", confirmation_code: "c" },
  await_call_event: { call_id: CALL_ID },
  answer_consult: { call_id: CALL_ID, event_id: "evt_law21", status: "working" },
  get_call_status: { call_id: CALL_ID },
  get_call_result: { call_id: CALL_ID },
  cancel_call: { call_id: CALL_ID },
};

async function withGateway(fn) {
  const gateway = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url.endsWith("/cancel") ? CANCEL_BODY : GATEWAY_BODY));
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const previous = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${gateway.address().port}`;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = previous;
    await new Promise((resolve) => gateway.close(resolve));
  }
}

async function withMcpClient(fn) {
  const server = new McpServer({ name: "hermes-law-21", version: "0.0.0" });
  registerTools(server, { consultAllowed: true, uiHost: { enabled: true }, language: "en" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hermes-law-21-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function keysDeep(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, found);
  } else if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      found.push(key);
      keysDeep(inner, found);
    }
  }
  return found;
}

function schemaPropertyNames(schema, found = []) {
  if (Array.isArray(schema)) {
    for (const item of schema) schemaPropertyNames(item, found);
  } else if (schema !== null && typeof schema === "object") {
    for (const [key, inner] of Object.entries(schema)) {
      if (key === "properties") found.push(...Object.keys(inner));
      schemaPropertyNames(inner, found);
    }
  }
  return found;
}

function stubFetch() {
  const requests = [];
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    requests.push(`${url} ${opts?.body?.toString() ?? ""}`);
    return {
      ok: true,
      status: 200,
      json: async () => ({ sid: "tnx_law21" }),
      text: async () => JSON.stringify({ sid: "tnx_law21" }),
    };
  };
  return { requests, restore: () => (global.fetch = original) };
}

test("LAW-21: kein Werkzeug-Schema ueber MCP traegt ein Audio-Feld", async () => {
  await withMcpClient(async (client) => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, TOOL_COUNT_WITH_CONSULT, "alle Werkzeuge registriert");
    for (const tool of tools) {
      const names = schemaPropertyNames([tool.inputSchema, tool.outputSchema]);
      assert.deepEqual(
        names.filter((name) => AUDIO_NAME.test(name)),
        [],
        `${tool.name}: Audio NIEMALS durch MCP`,
      );
    }
  });
});

test("LAW-21: keine Werkzeug-Antwort ueber MCP traegt Audio, auch wenn das Backend Audio-Felder liefert", async () => {
  await withGateway(() =>
    withMcpClient(async (client) => {
      const { tools } = await client.listTools();
      assert.equal(tools.length, TOOL_COUNT_WITH_CONSULT, "alle Werkzeuge registriert");
      for (const tool of tools) {
        const result = await client.callTool({ name: tool.name, arguments: TOOL_ARGS[tool.name] ?? {} });
        assert.notEqual(result.isError, true, `${tool.name}: Erfolgspfad erreicht ${JSON.stringify(result.content)}`);
        assert.deepEqual(
          result.content.filter((item) => item.type !== "text").map((item) => item.type),
          [],
          `${tool.name}: nur Text-Inhalte`,
        );
        const texts = result.content.map((item) => item.text).join("\n");
        assert.doesNotMatch(texts, AUDIO_NAME, `${tool.name}: Text ohne Audio-Verweis`);
        assert.deepEqual(
          keysDeep([result.structuredContent, result.content]).filter((key) => AUDIO_NAME.test(key)),
          [],
          `${tool.name}: Audio NIEMALS durch MCP`,
        );
      }
    }),
  );
});

test("LAW-21: Telnyx-Anrufsteuerung startet keine Aufnahme", async () => {
  const { requests, restore } = stubFetch();
  try {
    const voice = voiceControl();
    await voice.originateCall({
      from: "+13125550100",
      to: TO,
      url: "https://agent.test/voice/outbound?callId=call_law21",
      statusCallback: "https://agent.test/voice/status?callId=call_law21",
      statusCallbackEvent: ["answered", "completed"],
      method: "POST",
      timeLimit: 180,
    });
    await voice.redirectCall("tnx_law21", "https://agent.test/voice/turn?callId=call_law21");
    await voice.endCall("tnx_law21");
    await voice.endCallViaCallControl("ctl_law21");
  } finally {
    restore();
  }
  assert.equal(requests.length, 4, "jede Steuerung erreicht Telnyx");
  assert.deepEqual(
    requests.filter((request) => RECORDING.test(request)),
    [],
    "Hermes startet bei Telnyx keine Gespraechsaufnahme",
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerTools } from "../src/mcp-tools.js";
import { startServer, seedState, mcpPost, toolCall, readToolResult, ROOT, BASE_ENV } from "./helpers.js";

const HTTP_OK = 200;
const TOOLS_LIST_BODY = { jsonrpc: "2.0", id: 2, method: "tools/list" };

async function withMock(body, run) {
  const server = http.createServer((req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = url;
  try {
    await run();
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await new Promise((resolve) => server.close(resolve));
  }
}

function captureAgentStatusHandler() {
  const registrations = new Map();
  const fakeServer = {
    registerTool(name, config, handler) {
      registrations.set(name, { config, handler });
    },
    registerResource() {},
  };
  registerTools(fakeServer, {
    identity: null,
    scopedTenant: null,
    allowCalendar: true,
    consultAllowed: false,
    language: "de",
  });
  return registrations.get("get_agent_status");
}

test("P5a (O-13 Teil 1, in-process): get_agent_status wirft agent.voiceEngine/agent.model weg, obwohl der Gateway-Body sie real traegt", async () => {
  const gatewayBody = {
    agent: {
      number: "+491511234567",
      owner: "Antonio",
      voiceEngine: "budget",
      model: "claude-haiku",
    },
    usage: { calls: 5, planUsagePercent: 12 },
    settings: { allowSummaries: true, allowPersonalData: false, allowBankData: false },
  };
  const { handler } = captureAgentStatusHandler();

  await withMock(gatewayBody, async () => {
    const result = await handler({});
    assert.notEqual(result.isError, true, "Erfolgslauf ist kein Fehler");

    assert.ok(
      !Object.hasOwn(result.structuredContent, "voiceEngine"),
      "structuredContent traegt kein voiceEngine",
    );
    assert.ok(
      !Object.hasOwn(result.structuredContent, "model"),
      "structuredContent traegt kein model",
    );
    assert.equal(result.structuredContent.number, "+491511234567");
    assert.equal(typeof result.structuredContent.permissions, "string");

    const text = result.content[0].text;
    assert.ok(!text.includes("budget"), "Textblock traegt den voiceEngine-Wert nicht");
    assert.ok(!text.includes("claude-haiku"), "Textblock traegt den model-Wert nicht");
  });
});

test("P5a (O-13 Teil 1, HTTP /mcp): der echte Serverprozess liefert agent.voiceEngine/model an /api/state, aber nicht mehr im Tool-Output", async () => {
  const srv = await startServer({ seed: seedState({}) });
  try {
    const stateRes = await fetch(`${srv.localUrl}/api/state`);
    const state = await stateRes.json();
    assert.ok(
      Object.hasOwn(state.agent, "voiceEngine") && Object.hasOwn(state.agent, "model"),
      "Upstream /api/state traegt die Felder weiterhin (sonst beweist der Tool-Test nichts)",
    );

    const callRes = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("get_agent_status", {}));
    const callResult = await readToolResult(callRes);
    assert.notEqual(callResult.isError, true, "Erfolgslauf ist kein Fehler");
    assert.ok(
      !Object.hasOwn(callResult.structuredContent, "voiceEngine"),
      "structuredContent (HTTP) traegt kein voiceEngine",
    );
    assert.ok(
      !Object.hasOwn(callResult.structuredContent, "model"),
      "structuredContent (HTTP) traegt kein model",
    );
    assert.ok(
      Object.hasOwn(callResult.structuredContent, "number"),
      "Positiv-Kontrolle: number bleibt im structuredContent",
    );

    const listRes = await mcpPost(`${srv.localUrl}/mcp`, null, TOOLS_LIST_BODY);
    const listResult = await readToolResult(listRes);
    const tool = listResult.tools.find((entry) => entry.name === "get_agent_status");
    assert.ok(tool, "get_agent_status erscheint in tools/list");
    assert.ok(tool.outputSchema, "outputSchema ist deklariert");

    const props = tool.outputSchema.properties || {};
    assert.ok(!Object.hasOwn(props, "voiceEngine"), "outputSchema.properties ohne voiceEngine");
    assert.ok(!Object.hasOwn(props, "model"), "outputSchema.properties ohne model");
    assert.ok(Object.hasOwn(props, "number"), "Positiv-Kontrolle: number bleibt im Schema");

    const required = tool.outputSchema.required || [];
    assert.ok(!required.includes("voiceEngine"), "required nennt voiceEngine nicht");
    assert.ok(!required.includes("model"), "required nennt model nicht");
  } finally {
    await srv.stop();
  }
});

test("P5a (O-13 Teil 1, Beschreibung): die ausgelieferte tools/list-Beschreibung von get_agent_status verspricht kein voice engine/model mehr", async () => {
  const srv = await startServer({ seed: seedState({}) });
  try {
    const listRes = await mcpPost(`${srv.localUrl}/mcp`, null, TOOLS_LIST_BODY);
    const listResult = await readToolResult(listRes);
    const tool = listResult.tools.find((entry) => entry.name === "get_agent_status");
    assert.ok(tool, "get_agent_status erscheint in tools/list");

    const description = tool.description.toLowerCase();
    assert.doesNotMatch(description, /voice engine/, "Beschreibung verspricht kein voice engine mehr");
    assert.doesNotMatch(description, /\bmodel\b/, "Beschreibung verspricht kein model mehr");
    assert.match(description, /phone number/, "Positiv-Kontrolle: phone number bleibt genannt");
  } finally {
    await srv.stop();
  }
});

test("P5a (O-13 Teil 1, stdio, DP-1): der echte stdio-Kindprozess liefert get_agent_status ohne voiceEngine/model im outputSchema", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/mcp-server.js"],
    cwd: ROOT,
    env: BASE_ENV,
    stderr: "pipe",
  });
  let stderrOutput = "";
  transport.stderr?.on("data", (chunk) => {
    stderrOutput += chunk.toString();
  });
  const client = new Client({ name: "hermes-p5a-stdio-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const tool = tools.find((entry) => entry.name === "get_agent_status");
    assert.ok(tool, `get_agent_status erscheint in tools/list (stderr: ${stderrOutput})`);
    assert.ok(tool.outputSchema, "outputSchema ist deklariert");

    const props = tool.outputSchema.properties || {};
    assert.ok(!Object.hasOwn(props, "voiceEngine"), "stdio: outputSchema.properties ohne voiceEngine");
    assert.ok(!Object.hasOwn(props, "model"), "stdio: outputSchema.properties ohne model");
    assert.ok(Object.hasOwn(props, "number"), "stdio Positiv-Kontrolle: number bleibt im Schema");
  } finally {
    await client.close();
  }
});

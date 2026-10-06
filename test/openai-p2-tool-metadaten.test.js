import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerTools } from "../src/mcp-tools.js";
import { uiResourceUri } from "../src/ui/contract.js";
import { WIDGET_CALL } from "../src/ui/widget-catalog.js";
import {
  startServer,
  seedState,
  mcpPost,
  readToolResult,
  TOOL_COUNT_WITH_CONSULT,
  TOOL_COUNT_WITHOUT_CONSULT,
  TOOLS_WITH_OUTPUT_SCHEMA,
} from "./helpers.js";

const OPENAI_INVOKING_KEY = "openai/toolInvocation/invoking";
const OPENAI_INVOKED_KEY = "openai/toolInvocation/invoked";
const MAX_INVOCATION_CHARS = 64;
const RESOURCE_URI_CALL = uiResourceUri(WIDGET_CALL);
const CHATGPT_META_KEY = "openai/outputTemplate";
const CHATGPT_UI_MIME = "text/html+skybridge";
const HTTP_OK = 200;
const MOCK_GATEWAY_JSON_CONTENT_TYPE = { "content-type": "application/json" };

function assertTitleAndInvocationMeta(tools) {
  assert.ok(tools.length > 0, "tools/list liefert Werkzeuge");
  for (const tool of tools) {
    assert.equal(typeof tool.title, "string", `${tool.name}: title ist ein String`);
    assert.ok(tool.title.length > 0, `${tool.name}: title ist nicht leer`);

    const invoking = tool._meta?.[OPENAI_INVOKING_KEY];
    const invoked = tool._meta?.[OPENAI_INVOKED_KEY];
    assert.equal(
      typeof invoking,
      "string",
      `${tool.name}: ${OPENAI_INVOKING_KEY} ist ein nicht-leerer String`,
    );
    assert.ok(
      invoking.length > 0 && invoking.length <= MAX_INVOCATION_CHARS,
      `${tool.name}: invoking <= ${MAX_INVOCATION_CHARS} Zeichen`,
    );
    assert.equal(
      typeof invoked,
      "string",
      `${tool.name}: ${OPENAI_INVOKED_KEY} ist ein nicht-leerer String`,
    );
    assert.ok(
      invoked.length > 0 && invoked.length <= MAX_INVOCATION_CHARS,
      `${tool.name}: invoked <= ${MAX_INVOCATION_CHARS} Zeichen`,
    );
  }
}

function assertPlaceCallWidgetMetaSurvives(tools) {
  const placeCall = tools.find((tool) => tool.name === "place_call");
  assert.ok(placeCall, "place_call ist in der Liste");
  assert.equal(
    placeCall._meta?.ui?.resourceUri,
    RESOURCE_URI_CALL,
    "place_call: Widget-_meta bleibt neben den Statuszeilen erhalten",
  );
}

test("P2 (T-18/T-22): tools/list ueber die echte /mcp-Route traegt title + toolInvocation, Widget-_meta bleibt neben ihnen erhalten", async () => {
  const srv = await startServer({
    seed: seedState({}),
    env: { MCP_UI_ENABLED: "true", CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" },
  });
  try {
    const result = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, null, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    assertTitleAndInvocationMeta(result.tools);
    assertPlaceCallWidgetMetaSurvives(result.tools);

    const cancelCall = result.tools.find((tool) => tool.name === "cancel_call");
    assert.ok(cancelCall, "cancel_call erscheint in tools/list");
    assert.equal(
      typeof cancelCall._meta[OPENAI_INVOKING_KEY],
      "string",
      "cancel_call traegt trotz Migration eine Statuszeile",
    );
  } finally {
    await srv.stop();
  }
});

test("P2 (T-18 Rest): tools/list liefert eindeutige Namen, description/inputSchema an allen - und die outputSchema-Bilanz genau 10 von 12", async () => {
  const srv = await startServer({
    seed: seedState({}),
    env: { MCP_UI_ENABLED: "true", CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" },
  });
  try {
    const result = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, null, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    const { tools } = result;
    const namen = tools.map((tool) => tool.name);
    assert.equal(new Set(namen).size, namen.length, "jeder Name ist eindeutig");
    assert.equal(
      namen.length,
      TOOL_COUNT_WITH_CONSULT,
      "Owner + beide Consult-Schalter an -> alle zwoelf Werkzeuge",
    );

    let mitOutputSchema = 0;
    for (const tool of tools) {
      assert.equal(
        typeof tool.description,
        "string",
        `${tool.name}: description ist ein String`,
      );
      assert.ok(tool.description.length > 0, `${tool.name}: description ist nicht leer`);
      assert.equal(typeof tool.inputSchema, "object", `${tool.name}: inputSchema ist ein Objekt`);
      assert.ok(tool.inputSchema !== null, `${tool.name}: inputSchema ist nicht null`);
      if (tool.outputSchema !== undefined) mitOutputSchema += 1;
    }

    assert.equal(
      mitOutputSchema,
      TOOLS_WITH_OUTPUT_SCHEMA,
      "genau 10 der zwoelf Werkzeuge tragen ein outputSchema",
    );
    for (const ohneSchema of ["cancel_call", "list_action_items"]) {
      const tool = tools.find((entry) => entry.name === ohneSchema);
      assert.ok(tool, `${ohneSchema} ist in der Liste`);
      assert.equal(tool.outputSchema, undefined, `${ohneSchema}: kein outputSchema (nur text(...))`);
    }
  } finally {
    await srv.stop();
  }
});

function captureRegisterToolHandlers(ctx) {
  const handlers = new Map();
  const fakeServer = {
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return handlers;
}

async function withLocalGateway(body, run) {
  const server = http.createServer((req, res) => {
    res.writeHead(HTTP_OK, MOCK_GATEWAY_JSON_CONTENT_TYPE);
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const prevGatewayUrl = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    await run();
  } finally {
    if (prevGatewayUrl === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prevGatewayUrl;
    await new Promise((resolve) => server.close(resolve));
  }
}

test("P2 (Schritt 12): cancel_call und list_action_items arbeiten und liefern dabei nie structuredContent", async () => {
  const handlers = captureRegisterToolHandlers({ identity: null });

  await withLocalGateway({ status: "cancel_requested" }, async () => {
    const result = await handlers.get("cancel_call")({ call_id: "call_1" });
    assert.notEqual(result.isError, true, "cancel_call: kein isError - der Handler hat gearbeitet");
    const [{ text: cancelText }] = result.content;
    assert.ok(
      cancelText.includes("cancel_requested"),
      "cancel_call: die Mock-Antwort des Gateways erscheint im Text",
    );
    assert.equal(result.structuredContent, undefined, "cancel_call: kein structuredContent");
  });

  await withLocalGateway({ actionItems: [] }, async () => {
    const result = await handlers.get("list_action_items")();
    assert.notEqual(
      result.isError,
      true,
      "list_action_items: kein isError - der Handler hat gearbeitet",
    );
    assert.equal(result.structuredContent, undefined, "list_action_items: kein structuredContent");
  });
});

test("P2 (Schritt 13): stdio-Pfad (echtes SDK, InMemoryTransport) traegt title + toolInvocation genau wie ueber HTTP", async () => {
  const server = new McpServer({ name: "hermes-p2-test", version: "0.0.0" });
  registerTools(server, { uiHost: { enabled: true } });

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hermes-p2-test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.listTools();
    assert.equal(
      result.tools.length,
      TOOL_COUNT_WITHOUT_CONSULT,
      "stdio ohne Consult-Faehigkeit liefert zehn Werkzeuge",
    );
    assertTitleAndInvocationMeta(result.tools);
    assertPlaceCallWidgetMetaSurvives(result.tools);
  } finally {
    await client.close();
    await server.close();
  }
});

test("P2 (Schritt 14): Skybridge-Caps im uiHost aendern nichts - place_call traegt _meta.ui.resourceUri + toolInvocation, KEIN openai/outputTemplate", async () => {
  const server = new McpServer({ name: "hermes-p2-test", version: "0.0.0" });
  registerTools(server, {
    uiHost: {
      enabled: true,
      capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [CHATGPT_UI_MIME] } } },
    },
  });

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hermes-p2-test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.listTools();
    const placeCall = result.tools.find((tool) => tool.name === "place_call");
    assert.ok(placeCall, "place_call ist in der Liste");
    assert.equal(
      placeCall._meta?.ui?.resourceUri,
      RESOURCE_URI_CALL,
      "place_call: mcp-nativer Pfad, trotz Skybridge-Capability im uiHost",
    );
    assert.equal(
      typeof placeCall._meta?.[OPENAI_INVOKING_KEY],
      "string",
      "place_call traegt daneben die toolInvocation-Statuszeilen",
    );
    assert.equal(typeof placeCall._meta?.[OPENAI_INVOKED_KEY], "string");
    assert.equal(
      CHATGPT_META_KEY in (placeCall._meta || {}),
      false,
      "kein openai/outputTemplate - der Adapter, der ihn ausliefern wuerde, ist entfernt",
    );
  } finally {
    await client.close();
    await server.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerTools } from "../src/mcp-tools.js";
import { applyToolSecuritySchemes } from "../src/mcp-security-schemes.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { uiResourceUri } from "../src/ui/contract.js";
import { WIDGET_CALL } from "../src/ui/widget-catalog.js";
import {
  startServer,
  startIdp,
  seedState,
  mcpPost,
  readToolResult,
  ROOT,
  BASE_ENV,
  MCP_AUDIENCE,
  TOOL_COUNT_WITH_CONSULT,
  TOOL_COUNT_WITHOUT_CONSULT,
  TOOLS_WITH_OUTPUT_SCHEMA,
} from "./helpers.js";

const EXPECTED_SECURITY_SCHEMES = [{ type: "oauth2", scopes: ["openid", "email", "offline_access"] }];
const EXPECTED_NOAUTH_SECURITY_SCHEMES = [{ type: "noauth" }];
const LIST_TOOLS_METHOD = "tools/list";
const RAW_TOOLS_LIST_RESULT = z.object({ tools: z.array(z.any()) });
const RESOURCE_URI_CALL = uiResourceUri(WIDGET_CALL);
const MCP_SERVER_ENTRYPOINT = "src/mcp-server.js";

async function rawToolsList(client) {
  return client.request({ method: LIST_TOOLS_METHOD }, RAW_TOOLS_LIST_RESULT);
}

function assertSecuritySchemesOnEveryTool(tools) {
  assert.ok(tools.length > 0, "tools/list liefert Werkzeuge");
  for (const tool of tools) {
    assert.deepEqual(
      tool.securitySchemes,
      EXPECTED_SECURITY_SCHEMES,
      `${tool.name}: securitySchemes traegt genau [{"type":"oauth2","scopes":["openid","email","offline_access"]}]`,
    );
  }
}

function assertNoSecuritySchemesOnAnyTool(tools, grund = "keine Client-Auth dort") {
  assert.ok(tools.length > 0, "tools/list liefert Werkzeuge");
  for (const tool of tools) {
    assert.equal(tool.securitySchemes, undefined, `${tool.name}: securitySchemes fehlt (${grund})`);
  }
}

function assertNoauthSecuritySchemesOnEveryTool(tools) {
  assert.ok(tools.length > 0, "tools/list liefert Werkzeuge");
  for (const tool of tools) {
    assert.deepEqual(
      tool.securitySchemes,
      EXPECTED_NOAUTH_SECURITY_SCHEMES,
      `${tool.name}: securitySchemes traegt genau [{"type":"noauth"}]`,
    );
  }
}

function assertOutputAndP1P2FeldNichtZerschossen(tools) {
  let mitOutputSchema = 0;
  for (const tool of tools) {
    assert.equal(typeof tool.inputSchema, "object", `${tool.name}: inputSchema ist ein Objekt`);
    assert.equal(tool.inputSchema.type, "object", `${tool.name}: inputSchema.type === "object"`);
    assert.ok(tool.annotations, `${tool.name}: annotations ist vorhanden`);
    assert.equal(typeof tool.title, "string", `${tool.name}: title ist ein String`);
    assert.ok(tool.title.length > 0, `${tool.name}: title ist nicht leer`);
    assert.equal(
      typeof tool._meta?.["openai/toolInvocation/invoking"],
      "string",
      `${tool.name}: openai/toolInvocation/invoking ist ein String`,
    );
    if (tool.outputSchema !== undefined) mitOutputSchema += 1;
  }
  assert.equal(
    mitOutputSchema,
    TOOLS_WITH_OUTPUT_SCHEMA,
    "genau 10 der Werkzeuge tragen ein outputSchema (P1/P2 unveraendert)",
  );
  const placeCall = tools.find((tool) => tool.name === "place_call");
  assert.ok(placeCall, "place_call ist in der Liste");
  assert.equal(
    placeCall._meta?.ui?.resourceUri,
    RESOURCE_URI_CALL,
    "place_call: Widget-_meta bleibt neben securitySchemes erhalten",
  );
}

test("P3 (Lerntest): registerTool() verwirft securitySchemes still, der Override braucht die private SDK-Naht", async () => {
  const server = new McpServer({ name: "hermes-p3-lerntest", version: "0.0.0" });
  server.registerTool(
    "t1",
    { description: "d", inputSchema: {}, securitySchemes: EXPECTED_SECURITY_SCHEMES },
    async () => ({ content: [] }),
  );

  const protokoll = server.server;
  assert.ok(protokoll._requestHandlers instanceof Map, "_requestHandlers ist eine Map");
  assert.ok(
    protokoll._requestHandlers.has(LIST_TOOLS_METHOD),
    "_requestHandlers traegt tools/list nach der Registrierung",
  );

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hermes-p3-lerntest-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const roh = await rawToolsList(client);
    const t1Roh = roh.tools.find((tool) => tool.name === "t1");
    assert.ok(t1Roh, "t1 ist in der rohen Liste");
    assert.equal(
      t1Roh.securitySchemes,
      undefined,
      "registerTool() verwirft ein unbekanntes Konfigfeld still",
    );

    applyToolSecuritySchemes(server, "oauth");
    const getroffen = await client.listTools();
    const t1Getroffen = getroffen.tools.find((tool) => tool.name === "t1");
    assert.equal(
      t1Getroffen.securitySchemes,
      undefined,
      "client.listTools() (typisiert) strippt securitySchemes - ToolSchema hat kein .passthrough()",
    );
    const rohNachOverride = await rawToolsList(client);
    const t1RohNachOverride = rohNachOverride.tools.find((tool) => tool.name === "t1");
    assert.deepEqual(
      t1RohNachOverride.securitySchemes,
      EXPECTED_SECURITY_SCHEMES,
      "der rohe Weg traegt securitySchemes nach dem Override",
    );
  } finally {
    await client.close();
    await server.close();
  }
});

test("P3 (Lerntest): fehlt der Original-Handler, wirft applyToolSecuritySchemes statt still zu uebergehen", () => {
  const server = new McpServer({ name: "hermes-p3-leer", version: "0.0.0" });
  assert.throws(
    () => applyToolSecuritySchemes(server),
    /MCP-SDK-Naht verloren/,
    "kein Original-Handler -> lauter Wurf, kein stiller Uebersprung",
  );
});

test("P3 (Schritt 5): tools/list ueber die echte /mcp-Route traegt securitySchemes an jedem Werkzeug im oauth-Modus, P1/P2-Felder unveraendert", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    seed: seedState({}),
    env: {
      MCP_UI_ENABLED: "true",
      CONSULT_ENABLED: "true",
      ASSISTANT_CONTEXT_ENABLED: "true",
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      OAUTH_AUDIENCE: MCP_AUDIENCE,
      OWNER_IDP_SUBJECT: "user-1",
    },
  });
  try {
    const token = await idp.sign({ email: "p3-schritt5@team.test" });
    const result = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, token, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    assert.equal(
      result.tools.length,
      TOOL_COUNT_WITH_CONSULT,
      "Owner + beide Consult-Schalter an -> alle zwoelf Werkzeuge",
    );
    assertSecuritySchemesOnEveryTool(result.tools);
    assertOutputAndP1P2FeldNichtZerschossen(result.tools);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("P3 (Schritt 5b, T2-23-Nachtrag): tools/list im Legacy-Modus (MCP_AUTH=\"\") traegt securitySchemes NICHT - kein OAuth-Flow, keine Falschangabe", async () => {
  const srv = await startServer({
    seed: seedState({}),
    env: { MCP_UI_ENABLED: "true", CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" },
  });
  try {
    const result = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, null, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    assert.equal(result.tools.length, TOOL_COUNT_WITH_CONSULT);
    assertNoSecuritySchemesOnAnyTool(result.tools, "Legacy-Modus hat keinen OAuth-Flow");
    assertOutputAndP1P2FeldNichtZerschossen(result.tools);
  } finally {
    await srv.stop();
  }
});

test("P3 (Schritt 5c, T2-23-Nachtrag): tools/list im Token-Modus (MCP_AUTH=token) traegt securitySchemes NICHT - statischer Bearer-Token ist kein OAuth2", async () => {
  const srv = await startServer({
    seed: seedState({}),
    env: { MCP_AUTH: "token", MCP_AUTH_TOKEN: "t2-23-geheim" },
  });
  try {
    const result = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, "t2-23-geheim", { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    assert.ok(result.tools.length > 0);
    assertNoSecuritySchemesOnAnyTool(result.tools, "Token-Modus ist ein statischer Bearer-Token, kein OAuth2");
  } finally {
    await srv.stop();
  }
});

test("P3 (Schritt 5d, T2-23-Nachtrag): tools/list im off-Modus (MCP_AUTH=off) traegt securitySchemes als noauth auf jedem Werkzeug", async () => {
  const srv = await startServer({
    seed: seedState({}),
    env: { MCP_AUTH: "off" },
  });
  try {
    const result = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, null, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    assert.ok(result.tools.length > 0);
    assertNoauthSecuritySchemesOnEveryTool(result.tools);
  } finally {
    await srv.stop();
  }
});

test("P3 (Schritt 6a): stdio-Pfad (echtes SDK, InMemoryTransport) traegt securitySchemes NICHT - keine Client-Auth ueber stdio", async () => {
  const server = new McpServer({ name: "hermes-p3-stdio", version: "0.0.0" });
  registerTools(server, { uiHost: { enabled: true } });

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hermes-p3-stdio-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await rawToolsList(client);
    assert.equal(
      result.tools.length,
      TOOL_COUNT_WITHOUT_CONSULT,
      "stdio ohne Consult-Faehigkeit liefert zehn Werkzeuge",
    );
    assertNoSecuritySchemesOnAnyTool(result.tools);
  } finally {
    await client.close();
    await server.close();
  }
});

test("P3 (Schritt 7, T-15-Korrektur): der echte stdio-Einstieg (Kindprozess src/mcp-server.js) traegt securitySchemes an KEINEM Werkzeug - stdio hat keine Client-Auth, oauth2 waere dort eine Falschangabe", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER_ENTRYPOINT],
    cwd: ROOT,
    env: BASE_ENV,
    stderr: "pipe",
  });
  let stderrOutput = "";
  transport.stderr?.on("data", (chunk) => {
    stderrOutput += chunk.toString();
  });
  const client = new Client({ name: "hermes-p3-stdio-entrypoint-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    const result = await rawToolsList(client);
    assert.equal(
      result.tools.length,
      TOOL_COUNT_WITHOUT_CONSULT,
      `stdio-Einstieg ohne Consult-Faehigkeit liefert zehn Werkzeuge (stderr: ${stderrOutput})`,
    );
    assertNoSecuritySchemesOnAnyTool(result.tools);
  } finally {
    await client.close();
  }
});

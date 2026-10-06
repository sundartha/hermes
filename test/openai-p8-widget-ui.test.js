import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  startServer,
  seedState,
  mcpPost,
  toolCall,
  readToolResult,
  startIdp,
  ROOT,
  BASE_ENV,
} from "./helpers.js";
import { uiResourceUri } from "../src/ui/contract.js";
import { WIDGET_CALL } from "../src/ui/widget-catalog.js";
import { WIDGET_LOCALE_META_KEY } from "../src/ui/widget-i18n.js";
import { makeDefaultState, registerTenant, settingsFor } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const WIDGET_TOOL_COUNT = 5;
const WIDGET_RESOURCE_COUNT = 4;
const RESOURCE_URI_CALL = uiResourceUri(WIDGET_CALL);
const CHATGPT_UI_MIME = "text/html+skybridge";
const MCP_SERVER_ENTRYPOINT = "src/mcp-server.js";
const HTTP_OK = 200;
const EXPECTED_WIDGET_DOMAIN = "https://agent.test";
const EXPECTED_RESOURCE_META = {
  ui: { csp: { connectDomains: [], resourceDomains: [] } },
  "openai/widgetDomain": EXPECTED_WIDGET_DOMAIN,
};
const EXPECTED_TOOLS_RESOURCES_READS_HASH_HTTP =
  "180847f0bf2c2303ed2ec5dab715c429e80492a28403d4191374918bf0e3bf96";
const EXPECTED_TOOLS_RESOURCES_READS_HASH_STDIO =
  "180847f0bf2c2303ed2ec5dab715c429e80492a28403d4191374918bf0e3bf96";

const ANY = z.object({}).passthrough();

const SKYBRIDGE_CAPABILITIES = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [CHATGPT_UI_MIME] } },
};

function initializeBody(capabilities) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "p8-test-client", version: "0.0.0" },
      ...(capabilities ? { capabilities } : {}),
    },
  };
}

async function httpToolsList(baseUrl) {
  const res = await mcpPost(baseUrl, null, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  return (await readToolResult(res)).tools;
}

async function httpResourcesList(baseUrl) {
  const res = await mcpPost(baseUrl, null, { jsonrpc: "2.0", id: 3, method: "resources/list" });
  return (await readToolResult(res)).resources;
}

async function httpResourceRead(baseUrl, uri) {
  const res = await mcpPost(baseUrl, null, {
    jsonrpc: "2.0",
    id: 4,
    method: "resources/read",
    params: { uri },
  });
  return await readToolResult(res);
}

async function withStdioClient(env, capabilities, run) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER_ENTRYPOINT],
    cwd: ROOT,
    env: { ...BASE_ENV, ...env },
    stderr: "pipe",
  });
  let stderrOutput = "";
  transport.stderr?.on("data", (chunk) => {
    stderrOutput += chunk.toString();
  });
  const client = new Client({ name: "p8-test-stdio-client", version: "0.0.0" }, { capabilities });
  try {
    await client.connect(transport);
    await run(client, () => stderrOutput);
  } finally {
    await client.close();
  }
}

async function stdioRawToolsList(client) {
  return (await client.request({ method: "tools/list" }, ANY)).tools;
}

async function stdioRawResourcesList(client) {
  return (await client.request({ method: "resources/list" }, ANY)).resources;
}

async function stdioRawResourceRead(client, uri) {
  return await client.request({ method: "resources/read", params: { uri } }, ANY);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

const JSON_INDENT = 2;

function sha256Of(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

test("P8-A (HTTP): Skybridge-Capability (initialize UND direkt im tools/list-Request) aendert nichts - ein Renderer", async () => {
  const srv = await startServer({ seed: seedState({}), env: { MCP_UI_ENABLED: "true" } });
  try {
    const initRes = await mcpPost(`${srv.localUrl}/mcp`, null, initializeBody(SKYBRIDGE_CAPABILITIES));
    assert.equal(initRes.status, HTTP_OK, "initialize mit Skybridge-Capability wird angenommen");

    const tools = await httpToolsList(`${srv.localUrl}/mcp`);
    const placeCall = tools.find((tool) => tool.name === "place_call");
    assert.ok(placeCall, "place_call ist in der Liste");
    assert.equal(
      placeCall._meta?.ui?.resourceUri,
      RESOURCE_URI_CALL,
      "mcp-nativer Pfad (verschachteltes _meta.ui.resourceUri), trotz Skybridge-initialize",
    );
    assert.equal(
      "openai/outputTemplate" in (placeCall._meta || {}),
      false,
      "der Skybridge-Alias erscheint NICHT, obwohl initialize ihn deklarierte",
    );

    const read = await httpResourceRead(`${srv.localUrl}/mcp`, RESOURCE_URI_CALL);
    assert.equal(
      read.contents[0].mimeType,
      "text/html;profile=mcp-app",
      "mcp-nativer mimeType, nicht text/html+skybridge",
    );

    const res = await mcpPost(`${srv.localUrl}/mcp`, null, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/list",
      params: { capabilities: SKYBRIDGE_CAPABILITIES },
    });
    const toolsWithInlineCap = (await readToolResult(res)).tools;
    const placeCallInline = toolsWithInlineCap.find((tool) => tool.name === "place_call");
    assert.equal(
      placeCallInline._meta?.ui?.resourceUri,
      RESOURCE_URI_CALL,
      "Capability im tools/list-Request selbst aendert ebenfalls nichts",
    );
  } finally {
    await srv.stop();
  }
});

test("P8-B (stdio): Skybridge-Client-Capability aendert tools/list ueber den echten Kindprozess NICHT", async () => {
  await withStdioClient({ MCP_UI_ENABLED: "true" }, SKYBRIDGE_CAPABILITIES, async (client, stderr) => {
    const tools = await stdioRawToolsList(client);
    const placeCall = tools.find((tool) => tool.name === "place_call");
    assert.ok(placeCall, `place_call ist in der Liste (stderr: ${stderr()})`);
    assert.equal(
      placeCall._meta?.ui?.resourceUri,
      RESOURCE_URI_CALL,
      "mcp-nativer Pfad ueber stdio, trotz Client-Capability",
    );
    assert.equal(
      "openai/outputTemplate" in (placeCall._meta || {}),
      false,
      "kein Skybridge-Alias ueber stdio",
    );

    const read = await stdioRawResourceRead(client, RESOURCE_URI_CALL);
    assert.equal(read.contents[0].mimeType, "text/html;profile=mcp-app");
  });
});

test("P8-C (HTTP, T2-01, T-30/T-31 gebaut): jede Widget-Resource traegt _meta/mimeType/text/uri, _meta = Sollwert", async () => {
  const srv = await startServer({ seed: seedState({}), env: { MCP_UI_ENABLED: "true" } });
  try {
    const tools = await httpToolsList(`${srv.localUrl}/mcp`);
    const widgetTools = tools.filter((tool) => tool._meta?.ui?.resourceUri);
    assert.equal(widgetTools.length, WIDGET_TOOL_COUNT, "Positiv-Kontrolle: genau 5 Widget-Werkzeuge (prepare_call teilt sich WIDGET_CALL mit place_call)");

    for (const tool of widgetTools) {
      const read = await httpResourceRead(`${srv.localUrl}/mcp`, tool._meta.ui.resourceUri);
      assert.deepEqual(
        Object.keys(read.contents[0]).sort(),
        ["_meta", "mimeType", "text", "uri"],
        `${tool.name}: Resource-Inhalt traegt genau vier Felder, inkl. _meta`,
      );
      assert.deepEqual(
        read.contents[0]._meta,
        EXPECTED_RESOURCE_META,
        `${tool.name}: _meta = Sollwert (csp leer, widgetDomain = PUBLIC_URL-Origin)`,
      );
      assert.equal(read.contents[0].mimeType, "text/html;profile=mcp-app");
    }
  } finally {
    await srv.stop();
  }
});

test("P8-D (stdio, DP-1, T2-01, T-30/T-31 gebaut): derselbe Beleg ueber den echten stdio-Kindprozess", async () => {
  await withStdioClient({ MCP_UI_ENABLED: "true" }, {}, async (client, stderr) => {
    const tools = await stdioRawToolsList(client);
    const widgetTools = tools.filter((tool) => tool._meta?.ui?.resourceUri);
    assert.equal(widgetTools.length, WIDGET_TOOL_COUNT, `Positiv-Kontrolle (stderr: ${stderr()})`);

    for (const tool of widgetTools) {
      const read = await stdioRawResourceRead(client, tool._meta.ui.resourceUri);
      assert.deepEqual(
        Object.keys(read.contents[0]).sort(),
        ["_meta", "mimeType", "text", "uri"],
        `${tool.name}: Resource-Inhalt traegt genau vier Felder, inkl. _meta`,
      );
      assert.deepEqual(read.contents[0]._meta, EXPECTED_RESOURCE_META, `${tool.name}: _meta = Sollwert`);
      assert.equal(read.contents[0].mimeType, "text/html;profile=mcp-app");
    }
  });
});

test("P8-E (HTTP, T-23): jedes Widget-Werkzeug traegt _meta.ui.resourceUri (Standard-Key), keinen openai/outputTemplate-Alias, genau eine passende Resource", async () => {
  const srv = await startServer({ seed: seedState({}), env: { MCP_UI_ENABLED: "true" } });
  try {
    const tools = await httpToolsList(`${srv.localUrl}/mcp`);
    const resources = await httpResourcesList(`${srv.localUrl}/mcp`);
    const widgetTools = tools.filter((tool) => tool._meta?.ui?.resourceUri);
    assert.equal(widgetTools.length, WIDGET_TOOL_COUNT);

    for (const tool of widgetTools) {
      const uri = tool._meta.ui.resourceUri;
      assert.equal(typeof uri, "string");
      assert.equal(
        "openai/outputTemplate" in tool._meta,
        false,
        `${tool.name}: kein Legacy-Alias am Tool-Deskriptor noetig (Standard-Key reicht, T-23)`,
      );
      assert.equal(
        resources.filter((resource) => resource.uri === uri).length,
        1,
        `${tool.name}: genau eine Resource fuer ${uri}`,
      );
    }
  } finally {
    await srv.stop();
  }
});

test("P8-F (HTTP): Tool-Deskriptor-_meta und resources/list-Eintraege tragen unveraendert genau die Bestandsfelder", async () => {
  const srv = await startServer({ seed: seedState({}), env: { MCP_UI_ENABLED: "true" } });
  try {
    const tools = await httpToolsList(`${srv.localUrl}/mcp`);
    const widgetTools = tools.filter((tool) => tool._meta?.ui);
    assert.equal(widgetTools.length, WIDGET_TOOL_COUNT);
    for (const tool of widgetTools) {
      assert.deepEqual(
        Object.keys(tool._meta).sort(),
        ["openai/toolInvocation/invoked", "openai/toolInvocation/invoking", "ui"],
        `${tool.name}: Tool-_meta-Schluesselmenge unveraendert`,
      );
      assert.deepEqual(
        Object.keys(tool._meta.ui),
        ["resourceUri"],
        `${tool.name}: _meta.ui traegt seit T2-01 NUR noch resourceUri (csp/domain am Resource-Inhalt)`,
      );
    }

    const resources = await httpResourcesList(`${srv.localUrl}/mcp`);
    assert.equal(resources.length, WIDGET_RESOURCE_COUNT);
    for (const resource of resources) {
      assert.deepEqual(
        Object.keys(resource).sort(),
        ["mimeType", "name", "title", "uri"],
        "resources/list-Eintrag traegt unveraendert genau vier Felder",
      );
    }
  } finally {
    await srv.stop();
  }
});

test("P8-I (HTTP): tools/list + resources/list + alle resources/read byte-identisch zum gepinnten T2-01-Sollwert", async () => {
  const srv = await startServer({ seed: seedState({}), env: { MCP_UI_ENABLED: "true" } });
  try {
    const tools = await httpToolsList(`${srv.localUrl}/mcp`);
    const resources = await httpResourcesList(`${srv.localUrl}/mcp`);
    const reads = {};
    for (const resource of [...resources].sort((left, right) => left.uri.localeCompare(right.uri))) {
      reads[resource.uri] = (await httpResourceRead(`${srv.localUrl}/mcp`, resource.uri)).contents;
    }
    const captured = { tools, resources, reads };
    const hash = sha256Of(captured);
    assert.equal(
      hash,
      EXPECTED_TOOLS_RESOURCES_READS_HASH_HTTP,
      `Byte-Abweichung vom gepinnten T2-01-Sollwert, kanonisiertes Capture:\n${JSON.stringify(canonicalize(captured), null, JSON_INDENT)}`,
    );
  } finally {
    await srv.stop();
  }
});

test("P8-J (stdio): tools/list + resources/list + alle resources/read byte-identisch zum gepinnten T2-01-Sollwert", async () => {
  await withStdioClient({ MCP_UI_ENABLED: "true" }, {}, async (client, stderr) => {
    const tools = await stdioRawToolsList(client);
    const resources = await stdioRawResourcesList(client);
    const reads = {};
    for (const resource of [...resources].sort((left, right) => left.uri.localeCompare(right.uri))) {
      reads[resource.uri] = (await stdioRawResourceRead(client, resource.uri)).contents;
    }
    const captured = { tools, resources, reads };
    const hash = sha256Of(captured);
    assert.equal(
      hash,
      EXPECTED_TOOLS_RESOURCES_READS_HASH_STDIO,
      `Byte-Abweichung vom gepinnten T2-01-Sollwert (stderr: ${stderr()}), kanonisiertes Capture:\n${JSON.stringify(canonicalize(captured), null, JSON_INDENT)}`,
    );
  });
});

const WIDGET_LOCALE_TENANT_DE = { id: "t_p8k_de", sub: "sub-p8k-de", language: "de", e164: "+4915100000301" };
const WIDGET_LOCALE_TENANT_EN = { id: "t_p8k_en", sub: "sub-p8k-en", language: "en", e164: "+12025550301" };

function widgetLocaleTenantSeed() {
  const state = makeDefaultState();
  state.numbers.push({
    id: "num_owner_p8k",
    e164: "+4915199999801",
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
    status: "active",
    providerNumberId: null,
  });
  for (const tenant of [WIDGET_LOCALE_TENANT_DE, WIDGET_LOCALE_TENANT_EN]) {
    registerTenant(state, tenant.id, { idpSubject: tenant.sub });
    settingsFor(state, tenant.id).language = tenant.language;
    state.numbers.push({
      id: `num_${tenant.id}`,
      e164: tenant.e164,
      tenantId: tenant.id,
      provider: "telnyx",
      status: "active",
      providerNumberId: null,
    });
  }
  return state;
}

test("P8-K (HTTP, T2-02/S6): get_agent_number traegt _meta['hermes/locale'] in der Tenant-Sprache, list_action_items nicht", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, MULTI_TENANT: "true", MCP_UI_ENABLED: "true" },
    seed: widgetLocaleTenantSeed(),
  });
  try {
    const [tokenDe, tokenEn] = await Promise.all([
      idp.sign({ sub: WIDGET_LOCALE_TENANT_DE.sub }),
      idp.sign({ sub: WIDGET_LOCALE_TENANT_EN.sub }),
    ]);

    const [resDe, resEn] = await Promise.all([
      mcpPost(`${srv.localUrl}/mcp`, tokenDe, toolCall("get_agent_number")),
      mcpPost(`${srv.localUrl}/mcp`, tokenEn, toolCall("get_agent_number")),
    ]);
    const resultDe = await readToolResult(resDe);
    const resultEn = await readToolResult(resEn);
    assert.notEqual(resultDe.isError, true, "DE-Aufruf ist kein Fehler");
    assert.notEqual(resultEn.isError, true, "EN-Aufruf ist kein Fehler");
    assert.equal(resultDe._meta?.[WIDGET_LOCALE_META_KEY], "de", "DE-Mandant -> Sprachfeld de");
    assert.equal(resultEn._meta?.[WIDGET_LOCALE_META_KEY], "en", "EN-Mandant -> Sprachfeld en");
    assert.notEqual(
      resultDe._meta?.[WIDGET_LOCALE_META_KEY],
      resultEn._meta?.[WIDGET_LOCALE_META_KEY],
      "Positiv-Kontrolle: zwei verschiedene Sprachen ergeben zwei verschiedene Werte",
    );

    const nonWidgetRes = await mcpPost(`${srv.localUrl}/mcp`, tokenDe, toolCall("list_action_items"));
    const nonWidgetResult = await readToolResult(nonWidgetRes);
    assert.notEqual(nonWidgetResult.isError, true, "list_action_items ist kein Fehler");
    assert.equal(
      WIDGET_LOCALE_META_KEY in (nonWidgetResult._meta || {}),
      false,
      "list_action_items traegt kein Widget - kein Sprachfeld am Ergebnis",
    );
  } finally {
    await srv.stop();
    await idp.close();
  }
});

async function startFixedGatewayMock(body) {
  const server = http.createServer((req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("P8-L (HTTP, T2-02/S6): ein isError-Ergebnis traegt kein Sprachfeld", async () => {
  const mock = await startFixedGatewayMock({});
  const srv = await startServer({
    seed: seedState({}),
    env: { GATEWAY_URL: mock.url, MCP_UI_ENABLED: "true" },
  });
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("get_agent_number"));
    const result = await readToolResult(res);
    assert.equal(result.isError, true, "degradierte Gateway-Antwort -> isError (AC5/AC6)");
    assert.equal(
      WIDGET_LOCALE_META_KEY in (result._meta || {}),
      false,
      "ein Fehlerergebnis traegt niemals das Sprachfeld",
    );
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test("P8-M (stdio, T2-02/S6, DP-1): get_agent_number traegt _meta['hermes/locale']=Weltdefault, list_action_items nicht", async () => {
  const mock = await startFixedGatewayMock({ agent: { number: "+15005550006" }, actionItems: [] });
  try {
    await withStdioClient({ MCP_UI_ENABLED: "true", GATEWAY_URL: mock.url }, {}, async (client, stderr) => {
      const numberResult = await client.request(
        { method: "tools/call", params: { name: "get_agent_number", arguments: {} } },
        ANY,
      );
      assert.notEqual(numberResult.isError, true, `stdio get_agent_number ist kein Fehler (stderr: ${stderr()})`);
      assert.equal(
        numberResult._meta?.[WIDGET_LOCALE_META_KEY],
        "en",
        "stdio: kein Tenant-Kontext -> Weltdefault",
      );

      const itemsResult = await client.request(
        { method: "tools/call", params: { name: "list_action_items", arguments: {} } },
        ANY,
      );
      assert.notEqual(itemsResult.isError, true, "stdio list_action_items ist kein Fehler");
      assert.equal(
        WIDGET_LOCALE_META_KEY in (itemsResult._meta || {}),
        false,
        "list_action_items traegt kein Widget - kein Sprachfeld ueber stdio",
      );
    });
  } finally {
    await mock.close();
  }
});

test("P8-N (stdio, T2-02/S6): ein isError-Ergebnis traegt ueber den echten Kindprozess ebenfalls kein Sprachfeld", async () => {
  const mock = await startFixedGatewayMock({});
  try {
    await withStdioClient({ MCP_UI_ENABLED: "true", GATEWAY_URL: mock.url }, {}, async (client, stderr) => {
      const result = await client.request(
        { method: "tools/call", params: { name: "get_agent_number", arguments: {} } },
        ANY,
      );
      assert.equal(result.isError, true, `degradierte Gateway-Antwort -> isError (stderr: ${stderr()})`);
      assert.equal(
        WIDGET_LOCALE_META_KEY in (result._meta || {}),
        false,
        "ein Fehlerergebnis traegt niemals das Sprachfeld (stdio)",
      );
    });
  } finally {
    await mock.close();
  }
});

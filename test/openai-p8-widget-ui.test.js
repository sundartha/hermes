// P8 (T-30/T-31/T-23, X-7): Widget-UI, OpenAI-Alias-Schluessel am Resource-Inhalt.
//
// Faelle A/B belegen die Kern-Entscheidung der Spec (tasks/openai-p8-spec.md §1):
// der ChatGPT-Adapter ist auf dem Draht TOT - ein initialize-POST mit Skybridge-
// Capability aendert trotzdem NICHTS an tools/list oder resources/read, weil der
// stateless Transport (sessionIdGenerator=undefined) die dort deklarierten
// Capabilities nie zum naechsten POST mitfuehrt. Faelle C-H belegen Schritt 3
// (openai/widgetCSP + openai/widgetDomain am Resource-Inhalt des mcp-nativen
// Renderers) auf BEIDEN Pfaden (HTTP + stdio) und dass der ChatGPT-Adapter dabei
// unveraendert bleibt.
//
// Alle Faelle lesen ROH (eigenes JSON.parse ueber HTTP, bzw. client.request() mit
// einem passthrough-Schema ueber stdio) - nie einen typisierten SDK-Client fuer
// tools/list/resources/read, weil registerTool()/die generierten Result-Schemas
// unbekannte Felder still verwerfen (Lehre B-Serie, P3-Test). Testname traegt KEIN
// Katalog-/ABNAHME-Praefix (sonst landet er im falschen Lauf).
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { config } from "../src/config.js";
import { mcpNativeRenderer } from "../src/ui/adapters/mcp-native.js";
import { chatgptRenderer } from "../src/ui/adapters/chatgpt.js";
import { startServer, seedState, mcpPost, readToolResult, ROOT, BASE_ENV } from "./helpers.js";

const WIDGET_COUNT = 5;
const RESOURCE_URI_CALL = "ui://hermes/call";
const CHATGPT_UI_MIME = "text/html+skybridge";
const MCP_SERVER_ENTRYPOINT = "src/mcp-server.js";
const OPENAI_WIDGET_CSP_KEY = "openai/widgetCSP";
const OPENAI_WIDGET_DOMAIN_KEY = "openai/widgetDomain";
const EXPECTED_PUBLIC_URL = "https://agent.test"; // BASE_ENV.PUBLIC_URL
const HTTP_OK = 200;

// Permissives Ergebnis-Schema fuer rohe Requests ueber den typisierten SDK-Client
// (z.any() pro Feld umgeht das Strippen unbekannter Schluessel, Messung B/P3-Muster).
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

// Verbindet einen echten stdio-Kindprozess (src/mcp-server.js) und schickt danach
// initialize + capabilities getrennt vom Client-Connect (DP-1: derselbe Kindprozess-
// Pfad wie der reale Claude-Desktop-/OpenAI-Host).
async function withStdioClient(env, run) {
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
  const client = new Client(
    { name: "p8-test-stdio-client", version: "0.0.0" },
    { capabilities: SKYBRIDGE_CAPABILITIES },
  );
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

async function stdioRawResourceRead(client, uri) {
  return await client.request({ method: "resources/read", params: { uri } }, ANY);
}

// Liest die statische ui://-Resource eines Renderers zurueck (readback), in-process,
// ohne echten Transport - Muster test/mcp-ui.test.js readbackResource. Rest-Parameter
// (max-params): server.registerResource ruft mit vier Argumenten (name, uri, config,
// readCallback), nur das vierte interessiert hier.
function readbackResource(renderer, widgetId) {
  return new Promise((resolve) => {
    const fakeServer = {
      registerResource(...args) {
        const readCallback = args[3];
        resolve(readCallback());
      },
    };
    renderer.registerResource(fakeServer, widgetId);
  });
}

// ==================== P8-A/P8-B: ChatGPT-Adapter ist auf dem Draht tot ====================

test("P8-A (HTTP): Skybridge-initialize aendert tools/list und resources/read NICHT - mcp-nativer Pfad bleibt", async () => {
  const srv = await startServer({ seed: seedState({}), env: { MCP_UI_ENABLED: "true" } });
  try {
    const initRes = await mcpPost(`${srv.localUrl}/mcp`, null, initializeBody(SKYBRIDGE_CAPABILITIES));
    assert.equal(initRes.status, HTTP_OK, "initialize mit Skybridge-Capability wird angenommen");

    const tools = await httpToolsList(`${srv.localUrl}/mcp`);
    const placeCall = tools.find((tool) => tool.name === "place_call");
    assert.ok(placeCall, "place_call ist in der Liste");
    // Positiv-Kontrolle (Spec Schritt 2): _meta.ui muss vorhanden sein, sonst liefe
    // der Test bei MCP_UI_ENABLED=false unbemerkt leer gruen.
    assert.equal(
      placeCall._meta?.ui?.resourceUri,
      RESOURCE_URI_CALL,
      "mcp-nativer Pfad (verschachteltes _meta.ui.resourceUri), trotz Skybridge-initialize",
    );
    assert.equal(
      "openai/outputTemplate" in (placeCall._meta || {}),
      false,
      "der ChatGPT-Adapter-Schluessel erscheint NICHT, obwohl initialize ihn deklarierte",
    );

    const read = await httpResourceRead(`${srv.localUrl}/mcp`, RESOURCE_URI_CALL);
    assert.equal(
      read.contents[0].mimeType,
      "text/html;profile=mcp-app",
      "mcp-nativer mimeType, nicht text/html+skybridge",
    );
  } finally {
    await srv.stop();
  }
});

test("P8-B (stdio): Skybridge-Client-Capability aendert tools/list ueber den echten Kindprozess NICHT", async () => {
  await withStdioClient({ MCP_UI_ENABLED: "true" }, async (client, stderr) => {
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
      "kein ChatGPT-Adapter-Schluessel ueber stdio",
    );

    const read = await stdioRawResourceRead(client, RESOURCE_URI_CALL);
    assert.equal(read.contents[0].mimeType, "text/html;profile=mcp-app");
  });
});

// ==================== P8-C/P8-D: OpenAI-Alias-Schluessel am Resource-Inhalt ====================

function assertOpenAiAliasMeta(meta) {
  assert.deepEqual(
    meta,
    {
      [OPENAI_WIDGET_CSP_KEY]: { connect_domains: [], resource_domains: [] },
      [OPENAI_WIDGET_DOMAIN_KEY]: EXPECTED_PUBLIC_URL,
    },
    "Resource-_meta traegt exakt die zwei OpenAI-Alias-Schluessel",
  );
  assert.equal("ui" in meta, false, "kein Standard-Schluessel _meta.ui am Resource-Inhalt (O-P8-2)");
  assert.equal(
    "redirect_domains" in meta[OPENAI_WIDGET_CSP_KEY],
    false,
    "kein redirect_domains ohne openExternal-Ziel (X-7)",
  );
}

test("P8-C (HTTP, T-30/T-31): jede Widget-Resource traegt openai/widgetCSP + openai/widgetDomain, sonst nichts", async () => {
  const srv = await startServer({ seed: seedState({}), env: { MCP_UI_ENABLED: "true" } });
  try {
    const tools = await httpToolsList(`${srv.localUrl}/mcp`);
    const widgetTools = tools.filter((tool) => tool._meta?.ui?.resourceUri);
    assert.equal(widgetTools.length, WIDGET_COUNT, "Positiv-Kontrolle: genau 5 Widget-Werkzeuge");

    for (const tool of widgetTools) {
      const read = await httpResourceRead(`${srv.localUrl}/mcp`, tool._meta.ui.resourceUri);
      assertOpenAiAliasMeta(read.contents[0]._meta);
      assert.equal(read.contents[0].mimeType, "text/html;profile=mcp-app");
    }
  } finally {
    await srv.stop();
  }
});

test("P8-D (stdio, DP-1, T-30/T-31): derselbe Beleg ueber den echten stdio-Kindprozess", async () => {
  await withStdioClient({ MCP_UI_ENABLED: "true" }, async (client, stderr) => {
    const tools = await stdioRawToolsList(client);
    const widgetTools = tools.filter((tool) => tool._meta?.ui?.resourceUri);
    assert.equal(widgetTools.length, WIDGET_COUNT, `Positiv-Kontrolle (stderr: ${stderr()})`);

    for (const tool of widgetTools) {
      const read = await stdioRawResourceRead(client, tool._meta.ui.resourceUri);
      assertOpenAiAliasMeta(read.contents[0]._meta);
      assert.equal(read.contents[0].mimeType, "text/html;profile=mcp-app");
    }
  });
});

// ==================== P8-E: T-23 - Standard-Key resourceUri, kein Legacy-Alias noetig ====================

test("P8-E (HTTP, T-23): jedes Widget-Werkzeug traegt _meta.ui.resourceUri (Standard-Key), keinen openai/outputTemplate-Alias, genau eine passende Resource", async () => {
  const srv = await startServer({ seed: seedState({}), env: { MCP_UI_ENABLED: "true" } });
  try {
    const tools = await httpToolsList(`${srv.localUrl}/mcp`);
    const resources = await httpResourcesList(`${srv.localUrl}/mcp`);
    const widgetTools = tools.filter((tool) => tool._meta?.ui?.resourceUri);
    assert.equal(widgetTools.length, WIDGET_COUNT);

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

// ==================== P8-F: Nicht-Regression Tool-Deskriptor (Claude-Pfad unveraendert) ====================

test("P8-F (HTTP): Tool-Deskriptor-_meta und resources/list-Eintraege tragen unveraendert genau die Bestandsfelder", async () => {
  const srv = await startServer({ seed: seedState({}), env: { MCP_UI_ENABLED: "true" } });
  try {
    const tools = await httpToolsList(`${srv.localUrl}/mcp`);
    const widgetTools = tools.filter((tool) => tool._meta?.ui);
    assert.equal(widgetTools.length, WIDGET_COUNT);
    for (const tool of widgetTools) {
      assert.deepEqual(
        Object.keys(tool._meta).sort(),
        ["openai/toolInvocation/invoked", "openai/toolInvocation/invoking", "ui"],
        `${tool.name}: Tool-_meta-Schluesselmenge unveraendert`,
      );
      assert.deepEqual(
        Object.keys(tool._meta.ui).sort(),
        ["csp", "domain", "resourceUri"],
        `${tool.name}: _meta.ui-Schluesselmenge unveraendert`,
      );
    }

    const resources = await httpResourcesList(`${srv.localUrl}/mcp`);
    assert.equal(resources.length, WIDGET_COUNT);
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

// ==================== P8-G: fail-safe - leere publicUrl laesst nur die Domain entfallen ====================

test("P8-G (in-process, fail-safe): leere config.server.publicUrl laesst openai/widgetDomain entfallen, openai/widgetCSP bleibt", async () => {
  const zuvor = config.server.publicUrl;
  config.server.publicUrl = "";
  try {
    const readback = await readbackResource(mcpNativeRenderer, "call");
    const { _meta: meta } = readback.contents[0];
    assert.deepEqual(meta[OPENAI_WIDGET_CSP_KEY], { connect_domains: [], resource_domains: [] });
    assert.equal(
      OPENAI_WIDGET_DOMAIN_KEY in meta,
      false,
      "openai/widgetDomain entfaellt bei leerer publicUrl statt einen falschen Origin zu behaupten",
    );
  } finally {
    config.server.publicUrl = zuvor;
  }
});

// ==================== P8-H: ChatGPT-Adapter unveraendert ====================

test("P8-H (in-process): ChatGPT-Adapter liefert den Resource-Inhalt weiterhin OHNE _meta", async () => {
  const readback = await readbackResource(chatgptRenderer, "call");
  const content = readback.contents[0];
  assert.deepEqual(
    Object.keys(content).sort(),
    ["mimeType", "text", "uri"],
    "ChatGPT-Adapter-Resource-Inhalt bleibt bei genau drei Feldern (kein _meta)",
  );
});

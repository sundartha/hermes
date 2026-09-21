// P8 (T-30/T-31/T-23, X-7): Widget-UI, ChatGPT-Adapter auf Paritaet.
//
// ENDSTAND (Pruefer-Befund Runde 2, 2026-09-21): T-30/T-31 werden NICHT gebaut. Ein
// Zwischenstand setzte openai/widgetCSP + openai/widgetDomain (OpenAIs eigene "Legacy"-
// Alias-Schluessel) an resources/read des mcp-nativen Renderers - zurueckgenommen, s.
// src/ui/contract.js beim UI_CSP-Kommentar fuer die vollstaendige Begruendung. Kurz: der
// ChatGPT-Adapter ist auf dem Draht TOT (Faelle A/B unten), also ist mcpNativeRenderer
// der einzige Renderer, den je ein Client sieht - auch der heutige Claude-Connector
// (Regel 1 der Phase). Der Legacy-Alias haette dieses Live-Risiko getragen, OHNE T-30/T-31
// zu erfuellen (die verlangen woertlich den Standard-Schluessel `_meta.ui.csp`/
// `_meta.ui.domain`, X-7 begruendet den Legacy-Alias ausschliesslich mit
// `redirect_domains`, das hier nicht gesetzt wird). Faelle C/D/I/J belegen deshalb das
// Gegenteil: resources/read traegt auf BEIDEN Pfaden (HTTP + stdio) weiterhin KEIN
// zusaetzliches _meta - byte-identisch zu master, fuer JEDEN Client.
//
// Alle Faelle lesen ROH (eigenes JSON.parse ueber HTTP, bzw. client.request() mit
// einem passthrough-Schema ueber stdio) - nie einen typisierten SDK-Client fuer
// tools/list/resources/read, weil registerTool()/die generierten Result-Schemas
// unbekannte Felder still verwerfen (Lehre B-Serie, P3-Test). Testname traegt KEIN
// Katalog-/ABNAHME-Praefix (sonst landet er im falschen Lauf).
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chatgptRenderer } from "../src/ui/adapters/chatgpt.js";
import { startServer, seedState, mcpPost, readToolResult, ROOT, BASE_ENV } from "./helpers.js";

const WIDGET_COUNT = 5;
const RESOURCE_URI_CALL = "ui://hermes/call";
const CHATGPT_UI_MIME = "text/html+skybridge";
const MCP_SERVER_ENTRYPOINT = "src/mcp-server.js";
const HTTP_OK = 200;
// Byte-Beweis (Pruefer-Befund Runde 2, P8-I/P8-J unten): sha256 der kanonisierten
// (Schluessel sortiert) JSON-Serialisierung von tools/list + resources/list + jedem
// resources/read (alle 5 Widgets), einmal ueber HTTP und einmal ueber stdio. Berechnet
// gegen master f769841 UND gegen diesen Branch nach Rueckbau der Runde-2-Befunde -
// beide liefern denselben Hash (eigene Gegenprobe: zweiter, per node worktree ausgecheckter
// Baum auf f769841 mit identischem node_modules, dasselbe Capture-Verfahren wie unten).
const EXPECTED_TOOLS_RESOURCES_READS_HASH_HTTP =
  "baf9f1c9fdaa09f2ff706046b24c7b27a7b6eeffe1fb067772d7a4d54c4d36bf";
const EXPECTED_TOOLS_RESOURCES_READS_HASH_STDIO =
  "cb8d492a857fea4619efdd41a58ae5f5cfba4578f6ed9dcfa4ed7c34f3ee215a";

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

// Kanonisiert (Schluessel rekursiv sortiert) fuer eine stabile, Ordnungs-unabhaengige
// JSON-Serialisierung - Basis fuer den Byte-Beweis P8-I/P8-J. Object.fromEntries statt
// reduce+Mutation (kein no-param-reassign auf einem Fremd-Parameter).
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
      "kein ChatGPT-Adapter-Schluessel ueber stdio",
    );

    const read = await stdioRawResourceRead(client, RESOURCE_URI_CALL);
    assert.equal(read.contents[0].mimeType, "text/html;profile=mcp-app");
  });
});

// ==================== P8-C/P8-D: resources/read traegt weiterhin KEIN _meta ====================
// (T-30/T-31 nicht gebaut - Begruendung s. Dateikopf + src/ui/contract.js)

test("P8-C (HTTP, T-30/T-31 NICHT gebaut): jede Widget-Resource traegt exakt uri/mimeType/text, kein _meta", async () => {
  const srv = await startServer({ seed: seedState({}), env: { MCP_UI_ENABLED: "true" } });
  try {
    const tools = await httpToolsList(`${srv.localUrl}/mcp`);
    const widgetTools = tools.filter((tool) => tool._meta?.ui?.resourceUri);
    assert.equal(widgetTools.length, WIDGET_COUNT, "Positiv-Kontrolle: genau 5 Widget-Werkzeuge");

    for (const tool of widgetTools) {
      const read = await httpResourceRead(`${srv.localUrl}/mcp`, tool._meta.ui.resourceUri);
      assert.deepEqual(
        Object.keys(read.contents[0]).sort(),
        ["mimeType", "text", "uri"],
        `${tool.name}: Resource-Inhalt traegt genau drei Felder, kein _meta`,
      );
      assert.equal(read.contents[0].mimeType, "text/html;profile=mcp-app");
    }
  } finally {
    await srv.stop();
  }
});

test("P8-D (stdio, DP-1, T-30/T-31 NICHT gebaut): derselbe Beleg ueber den echten stdio-Kindprozess", async () => {
  await withStdioClient({ MCP_UI_ENABLED: "true" }, {}, async (client, stderr) => {
    const tools = await stdioRawToolsList(client);
    const widgetTools = tools.filter((tool) => tool._meta?.ui?.resourceUri);
    assert.equal(widgetTools.length, WIDGET_COUNT, `Positiv-Kontrolle (stderr: ${stderr()})`);

    for (const tool of widgetTools) {
      const read = await stdioRawResourceRead(client, tool._meta.ui.resourceUri);
      assert.deepEqual(
        Object.keys(read.contents[0]).sort(),
        ["mimeType", "text", "uri"],
        `${tool.name}: Resource-Inhalt traegt genau drei Felder, kein _meta`,
      );
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

// ==================== P8-I/P8-J: Byte-Beweis - voller Snapshot statt nur Schluesselmenge ====================
// (Pruefer-Befund Runde 2, "wichtig": P8-F prueft nur Schluesselmengen, nicht Werte/Bytes,
// und deckt resources/read gar nicht ab. Hier: sha256 der vollen, kanonisierten
// JSON-Serialisierung von tools/list + resources/list + jedem resources/read, verglichen
// mit dem eingecheckten master-Hash (s. Konstanten oben). Weicht ein Hash ab, muss der
// naechste Blick der volle Klartext-Diff sein (nicht nur "der Test ist rot") - deshalb
// wird bei Abweichung das kanonisierte Objekt mitgeloggt.

test("P8-I (HTTP): tools/list + resources/list + alle resources/read byte-identisch zu master", async () => {
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
      `Byte-Abweichung von master, kanonisiertes Capture:\n${JSON.stringify(canonicalize(captured), null, JSON_INDENT)}`,
    );
  } finally {
    await srv.stop();
  }
});

test("P8-J (stdio): tools/list + resources/list + alle resources/read byte-identisch zu master", async () => {
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
      `Byte-Abweichung von master (stderr: ${stderr()}), kanonisiertes Capture:\n${JSON.stringify(canonicalize(captured), null, JSON_INDENT)}`,
    );
  });
});

// P8 (T-30/T-31/T-23), Stand T2-01: Widget-UI, Skybridge-Adapter tot UND entfernt.
//
// T2-01 (Plan-Abschnitt 2.1, Harte Nuesse) baut T-30/T-31 jetzt: `_meta.ui.csp` und der
// ChatGPT-Alias `openai/widgetDomain` sitzen am resources/read-Inhalt (uiResourceMeta,
// src/ui/contract.js), nicht mehr am Tool-Deskriptor - kein MCP-Apps-Host liest csp/domain
// dort. Der Tool-Deskriptor traegt seither nur noch `_meta.ui.resourceUri` (T-23-
// Aufraeumen). Der Skybridge-/ChatGPT-Adapter (`text/html+skybridge`,
// `openai/outputTemplate`) ist ersatzlos entfernt: er war auf dem Draht bereits TOT
// (Faelle A/B unten pruefen das weiterhin, jetzt zusaetzlich ueber Capabilities IM
// tools/list-Request selbst - der einzige Weg, der den alten Adapter je erreicht haette).
// mcpNativeRenderer ist der einzige Renderer, den je ein Client sieht - auch der heutige
// Claude-Connector und ein kuenftiger ChatGPT-Connector (EIN Resource-Inhalt fuer beide).
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
import { startServer, seedState, mcpPost, readToolResult, ROOT, BASE_ENV } from "./helpers.js";
import { uiResourceUri } from "../src/ui/contract.js";
import { WIDGET_CALL } from "../src/ui/widget-catalog.js";

const WIDGET_COUNT = 5;
// T2-02/T-34: die URI traegt seither eine Version (Pin-Datei
// src/ui/widget-versions.json) - aus uiResourceUri() statt eines Literals, das bei
// jeder Versionserhoehung von Hand nachgezogen werden muesste.
const RESOURCE_URI_CALL = uiResourceUri(WIDGET_CALL);
const CHATGPT_UI_MIME = "text/html+skybridge";
const MCP_SERVER_ENTRYPOINT = "src/mcp-server.js";
const HTTP_OK = 200;
// BASE_ENV.PUBLIC_URL (test/helpers.js) - der Origin, den uiResourceMeta() daraus ableitet.
const EXPECTED_WIDGET_DOMAIN = "https://agent.test";
const EXPECTED_RESOURCE_META = {
  ui: { csp: { connectDomains: [], resourceDomains: [] } },
  "openai/widgetDomain": EXPECTED_WIDGET_DOMAIN,
};
// Byte-Beweis (Pruefer-Befund Runde 2, P8-I/P8-J unten): sha256 der kanonisierten
// (Schluessel sortiert) JSON-Serialisierung von tools/list + resources/list + jedem
// resources/read (alle 5 Widgets), einmal ueber HTTP und einmal ueber stdio. Neu gepinnt
// fuer T2-02 (T-34, Spec S1-S6): gegen den vorherigen Hash gesichtprueft, der EINZIGE
// Unterschied ist (a) jede resources/list-URI + resources/read-URI traegt jetzt eine
// Version (ui://hermes/<id>/v1.html statt ui://hermes/<id>, Pin-Datei
// src/ui/widget-versions.json), (b) jeder resources/read-Inhalt (text) ist jetzt EINE
// sprachneutrale Fassung (das eingebettete I18N-Script ist sprachunabhaengig, startet
// mit en) statt der vorherigen Fassung in der Tenant-Sprache (hier: Weltdefault, s.
// BASE_ENV). Vorheriger T2-01-Sollwert zum Vergleich: HTTP
// edf490f6dddb5a2a8a3176a6ecaf803bda03829364ad5b1b5915f23002a3d57a, stdio
// d65e36ed14b2d87e4f4b50f55a32e9ade76a88d4a934e9ee2b75f3ed8ab5c948.
const EXPECTED_TOOLS_RESOURCES_READS_HASH_HTTP =
  "d1038dfc2f1f51ad22b055c92c8155caacc57995784065ffbafe820fa9c4b89c";
const EXPECTED_TOOLS_RESOURCES_READS_HASH_STDIO =
  "bd4128d31d17468a962aefe223e85211c1c80795df4d17a1901a81dab2fcda47";

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

test("P8-A (HTTP): Skybridge-Capability (initialize UND direkt im tools/list-Request) aendert nichts - ein Renderer", async () => {
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
      "der Skybridge-Alias erscheint NICHT, obwohl initialize ihn deklarierte",
    );

    const read = await httpResourceRead(`${srv.localUrl}/mcp`, RESOURCE_URI_CALL);
    assert.equal(
      read.contents[0].mimeType,
      "text/html;profile=mcp-app",
      "mcp-nativer mimeType, nicht text/html+skybridge",
    );

    // Zusaetzlich (Spec S4): Capability DIREKT im tools/list-Request selbst (nicht nur im
    // initialize) - der einzige Weg, der den frueheren Adapter je erreicht haette. Ohne
    // Adapter gibt es hierfuer keinen Erreichungspfad mehr; das Ergebnis bleibt identisch.
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

// ==================== P8-C/P8-D: resources/read traegt jetzt csp/Origin (T-30/T-31) ====================
// Stand T2-01: das Resource-_meta ist umgedreht - es traegt jetzt den Sollwert statt zu
// fehlen (Begruendung s. Dateikopf + src/ui/contract.js uiResourceMeta).

test("P8-C (HTTP, T2-01, T-30/T-31 gebaut): jede Widget-Resource traegt _meta/mimeType/text/uri, _meta = Sollwert", async () => {
  const srv = await startServer({ seed: seedState({}), env: { MCP_UI_ENABLED: "true" } });
  try {
    const tools = await httpToolsList(`${srv.localUrl}/mcp`);
    const widgetTools = tools.filter((tool) => tool._meta?.ui?.resourceUri);
    assert.equal(widgetTools.length, WIDGET_COUNT, "Positiv-Kontrolle: genau 5 Widget-Werkzeuge");

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
    assert.equal(widgetTools.length, WIDGET_COUNT, `Positiv-Kontrolle (stderr: ${stderr()})`);

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
        Object.keys(tool._meta.ui),
        ["resourceUri"],
        `${tool.name}: _meta.ui traegt seit T2-01 NUR noch resourceUri (csp/domain am Resource-Inhalt)`,
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

// P8-H (ChatGPT-Adapter-Regressions-Pin) entfaellt: der Adapter ist seit T2-01 entfernt
// (s. test/openai-t2-01-widget-resource-meta.test.js T6 fuer den Ersatz-Beweis, dass kein
// Skybridge-Verhalten mehr existiert).

// ==================== P8-I/P8-J: Byte-Beweis - voller Snapshot statt nur Schluesselmenge ====================
// (Pruefer-Befund Runde 2, "wichtig": P8-F prueft nur Schluesselmengen, nicht Werte/Bytes,
// und deckt resources/read gar nicht ab. Hier: sha256 der vollen, kanonisierten
// JSON-Serialisierung von tools/list + resources/list + jedem resources/read, verglichen
// mit dem gepinnten T2-01-Sollwert (s. Konstanten oben, NICHT master - der Wert wurde seit
// P8 bewusst neu gepinnt, s. Kommentar dort). Weicht ein Hash ab, muss der naechste Blick
// der volle Klartext-Diff sein (nicht nur "der Test ist rot") - deshalb wird bei Abweichung
// das kanonisierte Objekt mitgeloggt.

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

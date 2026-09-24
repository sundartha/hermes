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

// T2-13 (N-10, Nachtrag - diese Konstanten waren nach dem T2-13-Merge nicht
// nachgezogen): prepare_call teilt sich seither dieselbe Widget-Resource (WIDGET_CALL)
// mit place_call (EIN enableWidgetUi(WIDGET_CALL)-Aufruf, an beide Tool-Deskriptoren
// gespreadet, s. Kommentar an callWidgetUi in mcp-tools.js) - die Zahl der WERKZEUGE mit
// Widget-_meta steigt dadurch von 4 auf 5, die Zahl der WIDGET-RESSOURCEN selbst bleibt
// bei 4 (kein zweiter resources/list-Eintrag, keine zweite Registrierung). Zwei
// Konstanten statt einer, weil beide Zahlen seit T2-13 auseinanderlaufen.
const WIDGET_TOOL_COUNT = 5;
const WIDGET_RESOURCE_COUNT = 4;
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
// T2-23-Nachtrag (unabhaengiger Pruefer, 2026-09-22): securitySchemes bildet jetzt
// den AKTIVEN mcpAuth-Modus ab statt immer "oauth2" zu behaupten
// (src/mcp-security-schemes.js). Dieser Test startet den Server im Legacy-Default
// (MCP_AUTH="", kein expliziter Modus) - dort ist "oauth2" seit dem Nachtrag eine
// Falschangabe (kein OAuth-Flow), also traegt securitySchemes hier gar KEIN Feld
// mehr (dieselbe Angabe wie ueber stdio, s. src/mcp-security-schemes.js). Der
// HTTP-Hash ist deshalb ab jetzt BYTE-IDENTISCH zum stdio-Hash - das ist keine
// zufaellige Kollision, sondern die direkte Folge: beide Pfade tragen ab jetzt kein
// securitySchemes. Voriger HTTP-Sollwert zum Vergleich (T2-23, volle oauth2-Angabe
// im Legacy-Default - das war der Regressionsbefund dieses Nachtrags):
// 00c916d4ece76dda6fa60de658979464c9dbd50d22596d77f53a6c49ea501b13.
// Neu gepinnt (N-11/N-12/N-13, ehrliche Werkzeug-Namen/Titel/Beschreibungen):
// get_transcript/get_my_number heissen jetzt get_call_result/get_agent_number, deren
// Titel und Statuszeilen aendern sich mit; answer_consult- und get_agent_status-
// Beschreibungen aendern sich (N-11/N-13). Voriger Sollwert (beide Pfade,
// byte-identisch seit dem securitySchemes-Nachtrag oben):
// bd4128d31d17468a962aefe223e85211c1c80795df4d17a1901a81dab2fcda47.
// Neu gepinnt (T2-11-Nachzug Widgets): call.html und my-number.html nennen die neuen
// Werkzeugnamen, beide Widgets tragen deshalb Pin-Version 2. Gegen den Klartext-Diff
// geprueft: EINZIGE Unterschiede sind die URIs call/my-number v1 -> v2 (resources/list,
// resources/read, tools/list _meta) und die umbenannten Namen im Widget-Text. Voriger
// Sollwert (beide Pfade): e36d8f9e7aa4b4fda25cc0d1518bb364fa25f4de597a24d54e763f3cee88599d.
// Neu gepinnt (T2-12, O-25/N-13): get_calendar-Werkzeug UND -Karte entfernt (tools/list
// -1 Eintrag, resources/list -1 Eintrag); alle vier verbleibenden Widgets tragen eine neue
// Version (WIDGET_DICT wird in jedes Widget serialisiert), also neue URIs fuer
// agent-status/calls/my-number/call. Voriger Sollwert (beide Pfade, byte-identisch seit
// dem T2-11-Nachzug oben): 72b3f3606e69272a0ee82b97aebde39550fbe74b99ba7433b2507f2cb1b8a5d6.
// Neu gepinnt (T2-12-Review-Nachtrag): Kommentar-Fix in src/ui/wing-canvas-mount-idle.js
// (Zahl "4 Read-only-Widgets" auf "3" korrigiert, calendar.html ist entfallen) - diese
// Datei wird ROH per readFileSync in agent-status/my-number/calls eingebettet
// (widget-catalog.js withWingCanvasMount), also neue Versionen fuer genau diese drei
// (call.html haengt nicht an dieser Datei, unveraendert). Voriger Sollwert (beide Pfade,
// byte-identisch seit T2-12 oben): 513bb73c23e4d7ea833711198fb306fbc92c8a496f5ff8a9d7224c85067a25aa.
// Neu gepinnt (T2-13-Nachtrag, Safety-Review): prepare_call ist neu registriert und
// traegt dasselbe callWidgetUi-_meta wie place_call (EIN enableWidgetUi(WIDGET_CALL)-
// Aufruf, an beide Tool-Deskriptoren gespreadet) - tools/list traegt seither einen
// fuenften Eintrag mit ui.resourceUri; resources/list und alle resources/read-Inhalte
// bleiben unveraendert (keine neue/geaenderte Resource). Nachgerechnet mit dem exakten
// Aufbau dieses Tests (tools/list + resources/list + jedes resources/read, kanonisiert),
// nicht geschaetzt. Voriger Sollwert (beide Pfade, byte-identisch seit dem T2-11-Nachzug
// oben): ffed5a5db028eaa0e37da11c2558f131f270dded0eab61760c8a6bc0a0212883.
const EXPECTED_TOOLS_RESOURCES_READS_HASH_HTTP =
  "84e8b490bb7811977a714e5358dc031bb4188431937bb2f21c741b42e797e3e4";
const EXPECTED_TOOLS_RESOURCES_READS_HASH_STDIO =
  "84e8b490bb7811977a714e5358dc031bb4188431937bb2f21c741b42e797e3e4";

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

// ==================== P8-E: T-23 - Standard-Key resourceUri, kein Legacy-Alias noetig ====================

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

// ==================== P8-F: Nicht-Regression Tool-Deskriptor (Claude-Pfad unveraendert) ====================

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

// ==================== P8-K..P8-N: T2-02/S6 - Widget-Sprache reist am Tool-Ergebnis (Draht) ====================
// Abnahme (4), PLAN-OPENAI-TECHNIK-2.md T2-02: "Widget-Tool-Ergebnis traegt das
// Sprachfeld (Draht)". Bisher pruefte nur die vm-Sandbox (mcp-ui-widget-i18n.test.js) das
// iframe-seitige Skript mit handgebauten Nachrichten - withWidgetLocale (mcp-tools.js)
// selbst lief nie ueber einen echten tools/call. Vier Faelle, je Transport zwei: das
// Sprachfeld traegt die Tenant-Sprache (Positiv-Kontrolle: zwei Sprachen, zwei Werte),
// ein Nicht-Widget-Werkzeug traegt es nie, ein isError-Ergebnis traegt es nie.

// HTTP: Muster MCP-16 (test/mcp-tools-i18n.test.js) - zwei per idpSubject gebundene
// Tenants mit eigener Sprache und eigener DID, ein OAuth-Token je Tenant.
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

// Ein-Feld-Gateway-Mock (Muster mcp-tools.test.js/P5b Fall C): liefert body fuer JEDEN
// Pfad. body={} degradiert requireFields() -> wrapHandler faengt den Throw -> errText
// (isError:true, AC5/AC6) - genau der Pfad, den withWidgetLocale NICHT erreicht (der
// Throw passiert VOR ihrem eigenen result?.isError-Zweig).
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
  const mock = await startFixedGatewayMock({}); // requireFields({agent:"object"}) wirft
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

// stdio hat KEINEN Store (mcp-server.js registriert ohne language-Feld, s. Kommentar
// dort) - loc.language faellt fail-safe auf DEFAULT_LANGUAGE zurueck (Weltdefault, "en",
// BASE_ENV pinnt WORLD_DEFAULT_LANGUAGE_ENABLED="true"). Zwei verschiedene Sprachen sind
// ueber stdio deshalb nicht messbar (kein Tenant-Kontext); gemessen wird, dass der
// Weltdefault tatsaechlich am Ergebnis ankommt.
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
  const mock = await startFixedGatewayMock({}); // requireFields({agent:"object"}) wirft
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

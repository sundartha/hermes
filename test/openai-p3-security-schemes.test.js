// P3 (T-15): securitySchemes an der SDK-Grenze (Weg B, Low-Level-Override).
//
// Alle Belege lesen ROHES JSON-RPC-JSON, nie einen typisierten SDK-Client
// (client.listTools()) - Messung B (tasks/openai-p3-spec.md §0.3) zeigt, dass
// ToolSchema (types.js) ein z.object(...) OHNE .passthrough() ist und zod unbekannte
// Top-Level-Schluessel beim Parsen stillschweigend entfernt. Ein Beleg ueber
// client.listTools() waere entweder faelschlich rot (Code stimmt) oder gruen aus dem
// falschen Grund (jemand schwaecht die Erwartung ab, bis sie nur noch "ein Feld
// existiert irgendwo" beweist - Pre-Mortem #3 der Spec).
//
// Die Erwartung steht als LITERAL aus dem zitierten Rohtext (developers.openai.com/
// apps-sdk/build/auth, s. tasks/openai-p3-report.md), nie aus src importiert - ein
// Test, der seine Erwartung aus dem Pruefling zieht, belegt nichts (Pre-Mortem #4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerTools } from "../src/mcp-tools.js";
import { applyToolSecuritySchemes } from "../src/mcp-security-schemes.js";
import { startServer, seedState, mcpPost, readToolResult } from "./helpers.js";
import { readFileSync } from "node:fs";

// Literal aus dem woertlich zitierten OpenAI-Rohtext (tasks/openai-p3-report.md,
// Fundstelle 1) - NICHT aus src importiert.
const EXPECTED_SECURITY_SCHEMES = [{ type: "oauth2", scopes: [] }];
const LIST_TOOLS_METHOD = "tools/list";
// Permissiver Ergebnis-Schema fuer rohe tools/list-Abfragen ueber den typisierten
// Client - z.any() pro Tool umgeht das Strippen unbekannter Felder (Messung B).
const RAW_TOOLS_LIST_RESULT = z.object({ tools: z.array(z.any()) });
// P0-Baseline-Staffelung (tasks/openai-p0-entscheidungen.md), identisch zu P2: Owner +
// beide Consult-Master-Schalter an -> zwoelf Werkzeuge, stdio ohne Consult-Faehigkeit
// -> zehn, davon tragen genau zehn ein outputSchema.
const TOOL_COUNT_WITH_CONSULT = 12;
const TOOL_COUNT_WITHOUT_CONSULT = 10;
const TOOLS_WITH_OUTPUT_SCHEMA = 10;
const RESOURCE_URI_CALL = "ui://hermes/call";
const CHATGPT_META_KEY = "openai/outputTemplate";
const CHATGPT_UI_MIME = "text/html+skybridge";

// Testnamen duerfen NICHT mit einer i18n-Katalog-Kennung + Ziffer beginnen
// (package.json config.i18nCatalogPattern), sonst wandern sie in den Gates-Lauf.
// Praefix "P3 (...): " ist sicher (wie "P2 (...): " in openai-p2-tool-metadaten.test.js).

async function rawToolsList(client) {
  return client.request({ method: LIST_TOOLS_METHOD }, RAW_TOOLS_LIST_RESULT);
}

function assertSecuritySchemesOnEveryTool(tools) {
  assert.ok(tools.length > 0, "tools/list liefert Werkzeuge");
  for (const tool of tools) {
    assert.deepEqual(
      tool.securitySchemes,
      EXPECTED_SECURITY_SCHEMES,
      `${tool.name}: securitySchemes traegt genau [{"type":"oauth2","scopes":[]}]`,
    );
  }
}

// Nicht-Regression im selben Response (AC2, Spec Schritt 5.3): der Override darf die
// SDK-Normalisierung und die P1/P2-Felder nicht zerschossen haben.
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

// Schritt 2 - Lerntest auf die SDK-Naht (prueft NUR das SDK, nicht Hermes-Code).
test("P3 (Lerntest): registerTool() verwirft securitySchemes still, der Override braucht die private SDK-Naht", async () => {
  const server = new McpServer({ name: "hermes-p3-lerntest", version: "0.0.0" });
  // securitySchemes steht direkt in der Tool-Konfig - kein bekanntes Feld von
  // registerTool() ({title, description, inputSchema, outputSchema, annotations,
  // _meta}, mcp.js:702-703). Belegt Zusicherung 2: das Feld faellt still weg.
  server.registerTool(
    "t1",
    { description: "d", inputSchema: {}, securitySchemes: EXPECTED_SECURITY_SCHEMES },
    async () => ({ content: [] }),
  );

  // Zusicherung 1: der Andockpunkt ist der private Original-Handler.
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
    // Zusicherung 2: im rohen Ergebnis fehlt securitySchemes trotz Konfig-Eingabe.
    const roh = await rawToolsList(client);
    const t1Roh = roh.tools.find((tool) => tool.name === "t1");
    assert.ok(t1Roh, "t1 ist in der rohen Liste");
    assert.equal(
      t1Roh.securitySchemes,
      undefined,
      "registerTool() verwirft ein unbekanntes Konfigfeld still",
    );

    // Override anwenden - jetzt traegt der ROHE Weg das Feld, der TYPISIERTE nicht
    // (Messung B): Zusicherung 3.
    applyToolSecuritySchemes(server);
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
  // Sicherung gegen ein SDK-Update, das das private Feld umbenennt (E5) - ein
  // McpServer OHNE registrierte Tools hat keinen tools/list-Handler.
  const server = new McpServer({ name: "hermes-p3-leer", version: "0.0.0" });
  assert.throws(
    () => applyToolSecuritySchemes(server),
    /MCP-SDK-Naht verloren/,
    "kein Original-Handler -> lauter Wurf, kein stiller Uebersprung",
  );
});

// Schritt 5 - Beleg ueber die echte HTTP-Route (AC1 + AC2 im selben Response).
test("P3 (Schritt 5): tools/list ueber die echte /mcp-Route traegt securitySchemes an jedem Werkzeug, P1/P2-Felder unveraendert", async () => {
  const srv = await startServer({
    seed: seedState({}),
    env: { MCP_UI_ENABLED: "true", CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" },
  });
  try {
    const result = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, null, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
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
  }
});

// Schritt 6a - stdio-Pfad, echtes SDK, roh abgefragt (kein Attrappen-Server).
test("P3 (Schritt 6a): stdio-Pfad (echtes SDK, InMemoryTransport) traegt securitySchemes genau wie ueber HTTP", async () => {
  const server = new McpServer({ name: "hermes-p3-stdio", version: "0.0.0" });
  registerTools(server, { uiHost: { enabled: true } });
  applyToolSecuritySchemes(server);

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
    assertSecuritySchemesOnEveryTool(result.tools);
  } finally {
    await client.close();
    await server.close();
  }
});

// Schritt 6b - ChatGPT-Adapter: securitySchemes haengt NICHT an der Adapterwahl.
test("P3 (Schritt 6b): ChatGPT-Adapter traegt securitySchemes neben openai/outputTemplate", async () => {
  const server = new McpServer({ name: "hermes-p3-chatgpt", version: "0.0.0" });
  registerTools(server, {
    uiHost: {
      enabled: true,
      capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [CHATGPT_UI_MIME] } } },
    },
  });
  applyToolSecuritySchemes(server);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hermes-p3-chatgpt-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await rawToolsList(client);
    assertSecuritySchemesOnEveryTool(result.tools);
    const placeCall = result.tools.find((tool) => tool.name === "place_call");
    assert.ok(placeCall, "place_call ist in der Liste");
    assert.equal(
      placeCall._meta?.[CHATGPT_META_KEY],
      RESOURCE_URI_CALL,
      "place_call traegt weiterhin den flachen openai/outputTemplate-String",
    );
    assert.deepEqual(
      placeCall.securitySchemes,
      EXPECTED_SECURITY_SCHEMES,
      "securitySchemes liegt daneben - unabhaengig von der Adapterwahl",
    );
  } finally {
    await client.close();
    await server.close();
  }
});

// Schritt 7 - Naht-Pin fuer den stdio-EINSTIEG. src/mcp-server.js ist nicht
// importierbar (Top-Level-await server.connect(...) an stdin/stdout) - Schritt 6a
// belegt nur den Mechanismus, nicht die Verdrahtung des Einstiegs. Ohne diesen Pin
// koennte die stdio-Zeile geloescht werden, ohne dass ein Test rot wird.
test("P3 (Schritt 7): src/mcp-server.js verdrahtet applyToolSecuritySchemes NACH registerTools", () => {
  const quelltext = readFileSync(new URL("../src/mcp-server.js", import.meta.url), "utf8");
  // Kommentare (Zeilenkommentare UND Blockkommentare, z.B. eine auskommentierte
  // Verdrahtungszeile bei der Gegenprobe) werden vor der indexOf-Suche entfernt -
  // sonst faende die Suche den Aufruf auch dann noch, wenn er nur noch als Text im
  // Kommentar steht, statt ausgefuehrt zu werden (das waere kein Beleg fuer die
  // Verdrahtung des Einstiegs). Blockkommentare zuerst entfernen, DANACH zeilenweise
  // filtern - sonst ueberlebt ein Aufruf, der komplett in einem /* ... */-Block liegt.
  const ohneBlockkommentare = quelltext.replace(/\/\*[\s\S]*?\*\//g, "");
  const ohneKommentarzeilen = ohneBlockkommentare
    .split("\n")
    .filter((zeile) => !zeile.trim().startsWith("//"))
    .join("\n");
  const indexRegisterTools = ohneKommentarzeilen.indexOf("registerTools(");
  const indexApply = ohneKommentarzeilen.indexOf("applyToolSecuritySchemes(");
  assert.ok(indexRegisterTools >= 0, "registerTools( kommt in src/mcp-server.js vor (nicht auskommentiert)");
  assert.ok(indexApply >= 0, "applyToolSecuritySchemes( kommt in src/mcp-server.js vor (nicht auskommentiert)");
  assert.ok(
    indexApply > indexRegisterTools,
    "applyToolSecuritySchemes steht HINTER dem registerTools-Aufruf",
  );
});

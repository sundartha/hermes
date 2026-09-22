// P2 (T-18/T-22): Registrierweg vereinheitlicht - title auf Top-Level, toolInvocation-
// Statuszeilen an _meta. Vier Pfade, vier Belege (kein Punkt gilt, bis er auf ALLEN
// betroffenen Pfaden gilt):
//   Schritt 10 - echte HTTP-/mcp-Route: title + toolInvocation je Werkzeug, Positiv-
//                Kontrolle, dass das Widget-_meta NICHT verdraengt wurde.
//   Schritt 11 - derselbe Response: der Rest des T-18-Wortlauts (Name eindeutig,
//                description/inputSchema, outputSchema-Bilanz genau 10 von 12).
//   Schritt 12 - der lokale Handler-Aufruf: cancel_call/list_action_items arbeiten
//                (isError=false, Mock-Antwort im Text) und liefern dabei nie
//                structuredContent (Verhaltens-Beleg, nicht nur "kein Schema deklariert").
//   Schritt 13 - der stdio-Pfad am ECHTEN SDK (InMemoryTransport, kein Attrappen-
//                Server): registerTool() verwirft unbekannte Config-Felder still
//                (P0/U-2), das faellt nur ueber den echten ListTools-Handler auf.
//   Schritt 14 - Skybridge-Caps aendern nichts (T2-01, Adapter entfernt): place_call
//                traegt weiterhin _meta.ui.resourceUri + toolInvocation, NIE
//                openai/outputTemplate - egal ob die Capability im uiHost oder direkt im
//                Request steht.
//
// Erwartungen stehen als LITERAL, nicht aus src importiert (Muster
// mcp-tool-annotations.test.js) - ein Test, der seine Erwartung aus dem Pruefling
// zieht, belegt nichts.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerTools } from "../src/mcp-tools.js";
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
const MAX_INVOCATION_CHARS = 64; // T-22 woertlich: "<= 64 chars"
const RESOURCE_URI_CALL = "ui://hermes/call";
const CHATGPT_META_KEY = "openai/outputTemplate";
const CHATGPT_UI_MIME = "text/html+skybridge";
const HTTP_OK = 200;
const MOCK_GATEWAY_JSON_CONTENT_TYPE = { "content-type": "application/json" };

// Testnamen duerfen NICHT mit einer der i18n-Katalog-Kennungen + Ziffer beginnen
// (package.json config.i18nCatalogPattern), sonst wandern sie in den Gates-Lauf statt
// in die Regressionsbank. Praefix "P2 (...): " ist sicher.

// Schritt 10: title + toolInvocation je Werkzeug, ueber die tatsaechlich gelieferte
// Liste (nie eine Namensliste - ein registerTool()-Konfigobjekt verwirft unbekannte
// Felder still, P0/U-2).
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

// Positiv-Kontrolle (Pre-Mortem #1 der Spec): das Widget-_meta von place_call ist
// TATSAECHLICH da und wurde vom Statuszeilen-Merge in withOpenAiToolMetadata() NICHT
// verdraengt. Ohne diese Kontrolle beweist die Schleife oben nur, dass nichts gemessen
// wurde (z.B. bei MCP_UI_ENABLED=false liefe sie leer und gruen durch).
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
  // MCP_UI_ENABLED=true ist NICHT optional: test/helpers.js setzt im BASE_ENV
  // MCP_UI_ENABLED=false - ohne den Override haette KEIN Tool ein Widget-_meta, die
  // Spread-Falle waere gar nicht im Raum, und dieser Test liefe gruen und leer durch.
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

    // cancel_call (Nicht-Widget, seit P2 migriert) ausdruecklich in der Pruefmenge -
    // sie ist Teil von result.tools und wurde damit oben bereits mitgeprueft; hier nur
    // die explizite Positiv-Kontrolle, dass sie wirklich dabei war.
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

// Schritt 11: der Rest des T-18-Wortlauts, ueber DIESELBE Konfiguration (Owner-Tenant +
// beide Consult-Master-Schalter an -> alle zwoelf Werkzeuge, P0-Baseline).
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

// Schritt 12: registerTool()-Aufrufe direkt einfangen (Muster test/mcp-tools.test.js
// captureTools), ein lokaler HTTP-Mock spielt das Gateway. Prueft, dass der Handler
// tatsaechlich arbeitet (isError=false, Mock-Antwort im Text) UND dabei nie
// structuredContent liefert - beides zusammen, weil sonst ein kaputter Handler
// (wrapHandler faengt jeden Wurf und liefert ebenfalls kein structuredContent) unbemerkt
// bliebe. Der Waechter gegen eine versehentlich mitgenommene outputSchema-Deklaration
// (Pre-Mortem #2, "Output validation error" am naechsten echten Anruf) ist Schritt 11 -
// dort laeuft der echte Output-Validator des SDK am Wire, hier wird der eingefangene
// Handler direkt aufgerufen und der Validator dabei umgangen.
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
  const handlers = captureRegisterToolHandlers({ identity: null, allowCalendar: true });

  await withLocalGateway({ status: "cancel_requested" }, async () => {
    const result = await handlers.get("cancel_call")({ call_id: "call_1" });
    // notEqual(true) statt equal(undefined): wrapHandler faengt JEDEN Wurf und liefert
    // ebenfalls kein structuredContent - erst diese Zusicherung trennt einen
    // arbeitenden vom kaputten Handler (Gegenprobe: toter GATEWAY_URL-Port liefert
    // {content:[{text:"fetch failed"}], isError:true}, structuredContent bliebe
    // trotzdem undefined).
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

// Schritt 13: der stdio-Pfad am ECHTEN SDK-ListTools-Handler, kein Attrappen-Server -
// InMemoryTransport + Client.listTools() ueber genau den ctx aus src/mcp-server.js:26-28
// ({ uiHost: { enabled } }, keine Consult-Faehigkeit, allowCalendar per Default).
// Staerker als ein Fake-Server: ein Feld, das registerTool() still verwirft (P0/U-2),
// faellt hier auf, weil der echte ListTools-Handler des SDK laeuft. Verbleibende Luecke
// (bewusst, s. Spec "Was diese Phase NICHT baut" #3): kein Kindprozess, keine Pipe-
// Serialisierung.
test("P2 (Schritt 13): stdio-Pfad (echtes SDK, InMemoryTransport) traegt title + toolInvocation genau wie ueber HTTP", async () => {
  const server = new McpServer({ name: "hermes-p2-test", version: "0.0.0" });
  registerTools(server, { uiHost: { enabled: true } });

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hermes-p2-test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.listTools();
    // stdio ohne ctx.consultAllowed (Default false) -> zehn statt zwoelf Werkzeuge
    // (P0-Baseline-Staffelung). Die Mengen-Erwartung steht hier separat von der
    // Feld-Pruefung, die dieselbe wie in Schritt 10 bleibt.
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

// Schritt 14 (T2-01): der Skybridge-/ChatGPT-Adapter ist entfernt (s. src/ui/registry.js)
// - eine Skybridge-Capability im uiHost aendert seither NICHTS mehr am mcp-nativen Pfad.
// Derselbe In-Memory-Harness wie Schritt 13, aber mit der Capability im ctx (frueher las
// uiRendererFor sie aus ctx.uiHost.capabilities; die Registry ignoriert das Feld jetzt).
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

#!/usr/bin/env node
// MCP-Server, Variante stdio (fuer Claude Desktop per "command"-Eintrag).
// Die HTTP-Variante (Custom Connector, claude.ai) laeuft direkt im Gateway: POST /mcp
// Gateway muss laufen: npm start
// MUSS erste Importzeile bleiben - globales Crash-Netz, ESM-Eval-Order (T-P0-07).
import "./process-guards.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./mcp-tools.js";
import { config, resolveGatewayUrl } from "./config.js";
import { HERMES_SERVER_INFO, mcpServerOptions } from "./mcp-server-info.js";

// Rich-UI auch ueber stdio (Claude Desktop). Anders als der HTTP-Connector rendert
// stdio die Widgets zuverlaessig: die HTTP-AppBridge-Doppel-Session ist Claude-seitig
// kaputt (anthropics/claude-ai-mcp#149), stdio teilt EINE Pipe. Server deklariert die
// io.modelcontextprotocol/ui-Extension + die Tools tragen das Widget-_meta (uiHost),
// gegated am Master-Schalter MCP_UI_ENABLED (aus -> byte-identisch).
//
// T-21: derselbe Options-Bauer wie der HTTP-Connector (routes/mcp.js) - sonst traegt der
// initialize-Response ueber stdio strukturell NIE instructions. mcpServerOptions() nimmt
// ausschliesslich zwei Booleans und beruehrt KEINEN Store (wichtig: dieser Prozess darf
// keinen zweiten pg-Pool oeffnen, s. Kommentar unten).
// Der Consult-Block bleibt aus, weil dieser Prozess registerTools() ohne consultAllowed
// aufruft (:26-28, Default false) - await_call_event/answer_consult existieren hier gar
// nicht, und eine Instruktion auf ein nicht registriertes Werkzeug waere eine Falschangabe.
const STDIO_CONSULT_LOOP = false;
const serverOptions = mcpServerOptions({
  uiEnabled: config.tenancy.mcpUiEnabled,
  consultLoop: STDIO_CONSULT_LOOP,
});
const server = new McpServer(HERMES_SERVER_INFO, serverOptions);
// P12: KEIN language-Feld - dieser Prozess hat keinen Store (ein Store-Import hier
// oeffnete einen zweiten pg-Pool/JSON-Leser). Ohne Feld faellt localeFor() auf den
// Weltdefault (R7). Der Tenant-genaue Kanal ist der HTTP-Connector (routes/mcp.js).
registerTools(server, {
  uiHost: { enabled: config.tenancy.mcpUiEnabled },
});
// T-15-Korrektur: KEIN applyToolSecuritySchemes() hier, bewusst anders als
// routes/mcp.js. stdio hat keine eigene Client-Authentifizierung - mcpAuth haengt
// ausschliesslich am HTTP-POST /mcp (src/auth.js, src/routes/mcp.js). Ein
// stdio-Client (Claude Desktop) weist NICHTS vor; was hier schuetzt, ist
// Herkunfts- statt Client-Auth (Loopback + internalOnly auf dem REST-Weg der
// Tools). "oauth2" ueber stdio zu melden waere deshalb eine FALSCHANGABE, die in
// die gefaehrliche Richtung irrt (Schutz behauptet, den es nicht gibt). Zudem
// erreicht OpenAI (T-15) diesen Prozess nie ueber stdio - nur die HTTP-Route
// zaehlt fuer diese Anforderung. Siehe src/mcp-security-schemes.js.
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[hermes] MCP-Server bereit (stdio). Gateway: " + resolveGatewayUrl());

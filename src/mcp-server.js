#!/usr/bin/env node
// MCP-Server, Variante stdio (fuer Claude Desktop per "command"-Eintrag).
// Die HTTP-Variante (Custom Connector, claude.ai) laeuft direkt im Gateway: POST /mcp
// Gateway muss laufen: npm start
// MUSS erste Importzeile bleiben - globales Crash-Netz, ESM-Eval-Order (T-P0-07).
import "./process-guards.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./mcp-tools.js";
import { config } from "./config.js";
import { uiServerExtension } from "./ui/contract.js";
import { HERMES_SERVER_INFO } from "./mcp-server-info.js";

// Rich-UI auch ueber stdio (Claude Desktop). Anders als der HTTP-Connector rendert
// stdio die Widgets zuverlaessig: die HTTP-AppBridge-Doppel-Session ist Claude-seitig
// kaputt (anthropics/claude-ai-mcp#149), stdio teilt EINE Pipe. Server deklariert die
// io.modelcontextprotocol/ui-Extension + die Tools tragen das Widget-_meta (uiHost),
// gegated am Master-Schalter MCP_UI_ENABLED (aus -> byte-identisch).
const serverOptions = config.mcpUiEnabled
  ? { capabilities: { extensions: uiServerExtension() } }
  : undefined;
const server = new McpServer(HERMES_SERVER_INFO, serverOptions);
registerTools(server, {
  uiHost: { enabled: config.mcpUiEnabled },
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  "[hermes] MCP-Server bereit (stdio). Gateway: " +
    (process.env.GATEWAY_URL || "http://localhost:3000"),
);

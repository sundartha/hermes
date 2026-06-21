#!/usr/bin/env node
// MCP-Server, Variante stdio (fuer Claude Desktop per "command"-Eintrag).
// Die HTTP-Variante (Custom Connector, claude.ai) laeuft direkt im Gateway: POST /mcp
// Gateway muss laufen: npm start
// MUSS erste Importzeile bleiben - globales Crash-Netz, ESM-Eval-Order (T-P0-07).
import "./process-guards.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./mcp-tools.js";

const server = new McpServer({ name: "hermes", version: "0.2.0" });
registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[hermes] MCP-Server bereit (stdio). Gateway: " + (process.env.GATEWAY_URL || "http://localhost:3000"));

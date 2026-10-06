#!/usr/bin/env node
import "./process-guards.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./mcp-tools.js";
import { config, resolveGatewayUrl } from "./config.js";
import { HERMES_SERVER_INFO, mcpServerOptions } from "./mcp-server-info.js";

const STDIO_CONSULT_LOOP = false;
const serverOptions = mcpServerOptions({
  uiEnabled: config.tenancy.mcpUiEnabled,
  consultLoop: STDIO_CONSULT_LOOP,
});
const server = new McpServer(HERMES_SERVER_INFO, serverOptions);
registerTools(server, {
  uiHost: { enabled: config.tenancy.mcpUiEnabled },
});
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[hermes] MCP-Server bereit (stdio). Gateway: " + resolveGatewayUrl());

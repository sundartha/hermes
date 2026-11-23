import { Router } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "../mcp-tools.js";
import { HERMES_SERVER_INFO, mcpServerOptions } from "../mcp-server-info.js";
import { applyToolSecuritySchemes } from "../mcp-security-schemes.js";
import { AUTH_FAILED_GRUND } from "../util.ts";
import { createRateLimiter } from "../middleware.ts";
import { BOOTSTRAP_TENANT_ID } from "../begriffe/mandant.js";
import { speicherBereiche } from "../store.js";

export const PROBE_MCP_PATH = "/intern/probe/mcp";
export const PROBE_WERKZEUGE = Object.freeze([
  "get_agent_number",
  "place_call",
  "get_call_status",
  "get_call_result",
  "list_calls",
  "cancel_call",
]);
const PROBE_TOKEN_MIN_LENGTH = 32;
const ABRUFE_PRO_MINUTE = 30;
const PROBE_IDENTITAET = "probe";

function nurProbeWerkzeuge(server) {
  return {
    registerTool: (name, ...rest) => {
      if (PROBE_WERKZEUGE.includes(name)) server.registerTool(name, ...rest);
    },
  };
}

export function makeInternProbeMcpRoutes({ config, store, bearerAbgewiesen }) {
  const router = Router();
  const begrenzer = createRateLimiter(ABRUFE_PRO_MINUTE);
  const bereiche = speicherBereiche(store);
  const schluessel = () => ({
    erwartet: config.auth.probeToken,
    mindestLaenge: PROBE_TOKEN_MIN_LENGTH,
    grund: AUTH_FAILED_GRUND.PROBE_TOKEN,
  });

  async function bediene(req, res) {
    const language = await bereiche.mandantProfil.tenantLanguage(BOOTSTRAP_TENANT_ID);
    const server = new McpServer(HERMES_SERVER_INFO, mcpServerOptions({ uiEnabled: false, consultLoop: false }));
    registerTools(nurProbeWerkzeuge(server), {
      identity: PROBE_IDENTITAET,
      scopedTenant: BOOTSTRAP_TENANT_ID,
      consultAllowed: false,
      language,
    });
    applyToolSecuritySchemes(server);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  router.post(PROBE_MCP_PATH, begrenzer, (req, res, next) => {
    if (bearerAbgewiesen(schluessel(), req, res)) return undefined;
    return bediene(req, res).catch(next);
  });

  return router;
}

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
import { HTTP_SERVER_ERROR } from "../utils/http.ts";

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

function schluesselAbgewiesen(bearerAbgewiesen, config, req, res) {
  const schluessel = {
    erwartet: config.auth.probeToken,
    mindestLaenge: PROBE_TOKEN_MIN_LENGTH,
    grund: AUTH_FAILED_GRUND.PROBE_TOKEN,
  };
  return bearerAbgewiesen(schluessel, req, res);
}

export function makeInternProbeMcpRoutes({ config, store, bearerAbgewiesen }) {
  const router = Router();
  const begrenzer = createRateLimiter(ABRUFE_PRO_MINUTE);
  const bereiche = speicherBereiche(store);

  router.post(PROBE_MCP_PATH, begrenzer, async (req, res) => {
    if (schluesselAbgewiesen(bearerAbgewiesen, config, req, res)) return;
    try {
      const language = await bereiche.mandantProfil.tenantLanguage(BOOTSTRAP_TENANT_ID);
      const server = new McpServer(HERMES_SERVER_INFO, mcpServerOptions({ uiEnabled: false, consultLoop: false }));
      registerTools(nurProbeWerkzeuge(server), {
        identity: PROBE_IDENTITAET,
        scopedTenant: BOOTSTRAP_TENANT_ID,
        consultAllowed: false,
        consultTore: {},
        uiHost: { enabled: false, chatgptEgress: false },
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
    } catch (err) {
      console.error("[probe-mcp]", err.message);
      if (!res.headersSent)
        res
          .status(HTTP_SERVER_ERROR)
          .json({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null });
    }
  });

  return router;
}

import { Router } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "../mcp-tools.js";
import { registerNoTenantStubs } from "../mcp-no-tenant.js";
import { HERMES_SERVER_INFO, mcpServerOptions } from "../mcp-server-info.js";
import { applyToolSecuritySchemes } from "../mcp-security-schemes.js";
import { consultAllowedFor } from "../consult/gate.js";
import { makeMcpAuth } from "../auth.js";
import { audit, hashEmail } from "../util.js";
import { ANON_IDENTITY, TENANT_REJECT } from "../request-tenant.js";
import { tenantLanguage } from "../store/views.js";
import {
  createMcpOriginGuard,
  createMcpCors,
  mcpErlaubteOrigins,
  RATE_LIMIT_BODY,
  respondTooManyRequests,
} from "../middleware.js";
import { isChatGptEgressIp } from "../ui/chatgpt-egress.js";

export function mcpRequestLabel(body) {
  const method = body?.method || "";
  const toolName = method === "tools/call" ? body?.params?.name : null;
  return typeof toolName === "string" && toolName ? `${method} ${toolName}` : method;
}

const HTTP_FORBIDDEN = 403;

function auditNoTenant(scopedTenant, req) {
  if (scopedTenant !== TENANT_REJECT) return;
  audit("auth_failed", req, "path=/mcp grund=kein_tenant");
}

function rejectIfNoTenant(scopedTenant, req, res) {
  if (scopedTenant !== TENANT_REJECT || req.auth) return false;
  res.status(HTTP_FORBIDDEN).json({ error: "Keine Tenant-Zuordnung fuer diese Identitaet." });
  return true;
}

function logAndResolveIdentity({ req, scopedTenant }) {
  if (req.auth)
    console.log(
      "[mcp]",
      req.auth.email ? hashEmail(req.auth.email) : "anonym",
      `tenant=${scopedTenant}`,
      mcpRequestLabel(req.body),
    );
  return req.auth ? req.auth.email || req.auth.sub || ANON_IDENTITY : null;
}

function logAndDetectChatgptEgress(req) {
  const chatgptEgress = isChatGptEgressIp(req.ip);
  console.log("[mcp] client-class", chatgptEgress ? "chatgpt" : "andere");
  return chatgptEgress;
}

export function makeMcpRoutes({ config, store, requestTenant, mcpDrosseln, bodyParsers }) {
  const router = Router();
  const mcpAuth = makeMcpAuth({ ablehnungsDrossel: mcpDrosseln.ablehnung, ipSperre: mcpDrosseln.ipSperre });

  function mandantDrossel(req, res, next) {
    const scopedTenant = requestTenant(req);
    Object.assign(res.locals, { scopedTenant });
    const { allowed, retryAfterS } = mcpDrosseln.mandant(req, { scopedTenant });
    if (!allowed) return respondTooManyRequests(res, { retryAfterS, body: RATE_LIMIT_BODY });
    next();
  }

  router.use(
    "/mcp",
    createMcpOriginGuard({
      erlaubteOrigins: mcpErlaubteOrigins({
        publicUrl: config.server.publicUrl,
        zusaetzlicheOrigins: config.safety.mcpAllowedOrigins,
      }),
      enforce: config.safety.mcpOriginEnforce,
      ablehnungsDrossel: mcpDrosseln.ablehnung,
    }),
  );

  router.use(
    "/mcp",
    createMcpCors({
      corsOrigins: mcpErlaubteOrigins({ zusaetzlicheOrigins: config.safety.mcpAllowedOrigins }),
    }),
  );

  router.post("/mcp", mcpAuth, mandantDrossel, ...bodyParsers, async (req, res) => {
    const scopedTenant = res.locals.scopedTenant;
    auditNoTenant(scopedTenant, req);
    if (rejectIfNoTenant(scopedTenant, req, res)) return;
    const identity = logAndResolveIdentity({ req, scopedTenant });
    const profile = store.resolveProfile(scopedTenant);
    const language = tenantLanguage(store.load(), scopedTenant);
    try {
      const consultLoop = consultAllowedFor(profile);
      const serverOptions = mcpServerOptions({
        uiEnabled: config.tenancy.mcpUiEnabled,
        consultLoop,
      });
      const server = new McpServer(HERMES_SERVER_INFO, serverOptions);
      const uiEnabled = config.tenancy.mcpUiEnabled;
      const uiHost = {
        enabled: uiEnabled,
        chatgptEgress: uiEnabled ? logAndDetectChatgptEgress(req) : false,
      };
      const register = scopedTenant === TENANT_REJECT ? registerNoTenantStubs : registerTools;
      register(server, {
        identity,
        scopedTenant,
        consultAllowed: consultLoop,
        uiHost,
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
      console.error("[mcp]", err.message);
      if (!res.headersSent)
        res
          .status(500)
          .json({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null });
    }
  });
  router.get("/mcp", (_req, res) => res.status(405).json({ error: "POST only (stateless transport)" }));
  router.delete("/mcp", (_req, res) =>
    res.status(405).json({ error: "POST only (stateless transport)" }),
  );

  return router;
}

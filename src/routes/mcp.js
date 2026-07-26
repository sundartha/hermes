// ---- makeMcpRoutes (Server-Slim P12) --------------------------------------------
// Extrahierte /mcp-Route-Gruppe (POST mit mcpAuth, GET/DELETE -> 405) als Factory mit
// Dependency-Injection - gleiches Muster wie makeReadRoutes/makeBillingRoutes/
// makeVoiceRoutes. Teil der server.js-Decomposition (PLAN-SERVER-SLIM P12): reine
// Verschiebung, Verhalten unveraendert.
//
// STATELESS (INV-8, KRITISCH): McpServer + StreamableHTTPServerTransport werden PRO
// REQUEST im Handler gebaut (sessionIdGenerator: undefined) mit res.on("close")-Cleanup
// - KEIN Hoisting/Caching ueber Requests. Ein "optimierendes" Hoisten braeche den
// stateless Streamable-HTTP-Vertrag (die initialize-Capabilities wandern beim
// sessionIdGenerator=undefined nicht zum tools/list-POST mit).
//
// /mcp ist Auth-Gate-exempt (der Basic-Auth-Gate in server.js ruft next() fuer /mcp*,
// INV-3); mcpAuth (src/auth.js: Legacy-Bearer-Token, statisches Token oder OAuth 2.1)
// ist die EINZIGE Absicherung auf POST und bleibt fail-closed (Default nur localhost).
// GET/DELETE tragen KEINE Auth (nur 405). Die stateless/pure Bausteine (McpServer,
// Transport, registerTools, uiServerExtension, HERMES_SERVER_INFO, mcpAuth, hashEmail,
// ANON_IDENTITY) kommen direkt aus ihren Quellmodulen (eine Quelle, G5 - wie
// normNum/localeFor in makeVoiceRoutes); nur config/store und der EINE requestTenant-
// Resolver (INV-7) werden injiziert.
import { Router } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "../mcp-tools.js";
import { uiServerExtension } from "../ui/contract.js";
import { HERMES_SERVER_INFO } from "../mcp-server-info.js";
import { mcpAuth } from "../auth.js";
import { hashEmail } from "../util.js";
import { ANON_IDENTITY } from "../request-tenant.js";
import { tenantLanguage } from "../store/views.js";

// deps: { config, store, requestTenant }. config = globales Config-Objekt (mcpUiEnabled).
// store traegt resolveProfile. requestTenant = die EINE Wurzel-Instanz (INV-7; loest den
// Tenant EINMAL aus dem verifizierten JWT auf und reicht ihn als X-Internal-Tenant weiter).
export function makeMcpRoutes({ config, store, requestTenant }) {
  const router = Router();

  // ================= MCP ueber Streamable HTTP (Custom Connector) =================
  // Stateless: pro Request ein frischer Server+Transport (einfach & robust fuer den Prototyp).
  // Auth via mcpAuth-Middleware (src/auth.js): Legacy-Bearer-Token, statisches
  // Token oder OAuth 2.1 (MCP_AUTH). Fail-closed bleibt Default (nur localhost).
  router.post("/mcp", mcpAuth, async (req, res) => {
    // tenant=<id|reject|owner> auditiert die I4-Aufloesung (kein Secret: nur die
    // tenantId, nie email/sub). Flag aus -> immer tenant=owner (byte-identisch).
    // E-Mail wird gehasht (T-P0-7): dieses Diagnose-Log laeuft pro Request und landet
    // im Render-stdout - die Klartext-Adresse waere PII at rest. Der forensische
    // Identitaets-Nachweis bleibt vollstaendig im audit()-Trail (requestedBy).
    // AM6: Tenant EINMAL aus dem verifizierten JWT aufloesen (req.auth.sub) und an die
    // In-Process-Tools reichen (scopedTenant als X-Internal-Tenant), damit der REST-Hop
    // nicht aus der email-first Identitaet re-aufloest (sub/email-Divergenz). Flag aus ->
    // requestTenant === BOOTSTRAP_TENANT_ID (byte-identisch).
    const scopedTenant = requestTenant(req);
    if (req.auth)
      console.log(
        "[mcp]",
        req.auth.email ? hashEmail(req.auth.email) : "anonym",
        `tenant=${scopedTenant}`,
        req.body?.method || "",
      );
    // Identitaet aus dem verifizierten JWT (req.auth). email bevorzugt, sonst sub. Sie wird
    // als X-Internal-Identity an die In-Process-Tools gereicht (Audit/requestedBy) - NICHT
    // mehr fuer das Rechteprofil. Kein req.auth (Legacy/localhost/stdio) -> null.
    const identity = req.auth ? req.auth.email || req.auth.sub || ANON_IDENTITY : null;
    // Rechteprofil keyt seit Phase S auf den am Gateway aufgeloesten Tenant (scopedTenant),
    // nicht auf die email-/sub-Identitaet. BOOTSTRAP -> OWNER_PROFILE, sonst stored-or-DEFAULT
    // (fail-closed: ein authentifizierter Nutzer ohne Tenant-Profil bekommt DEFAULT_PROFILE).
    const profile = store.resolveProfile(scopedTenant);
    // P12: die Sprache des MCP-Textkanals ist die Sprache des TENANTS - aufgeloest mit
    // derselben Funktion und derselben Praezedenz wie im Anruf (views.tenantLanguage ->
    // resolveCallLanguage), nie aus einem Request-Header oder Client-Locale. EINE
    // Aufloesungsregel fuer Anruf, Self-Service und MCP (G5). Muster: self-service-routes.js.
    const language = tenantLanguage(store.load(), scopedTenant);
    try {
      // Rich-UI: Server deklariert die io.modelcontextprotocol/ui-Extension im initialize-
      // Response (MCP Apps / SEP-1865 - PFLICHT, sonst rendert der Host das ui://-Widget
      // NICHT, auch bei korrektem Tool-_meta). Nur bei aktivem Master-Schalter; aus ->
      // keine Extension -> byte-identisch. Auto-registrierte tools/resources werden vom SDK
      // dazugemerged (verdraengen die Extension nicht).
      const serverOptions = config.tenancy.mcpUiEnabled
        ? { capabilities: { extensions: uiServerExtension() } }
        : undefined;
      const server = new McpServer(HERMES_SERVER_INFO, serverOptions);
      // Rich-UI-Host-Hinweis: gegated NUR durch den Master-Schalter config.tenancy.mcpUiEnabled
      // (aus -> uiHost.enabled=false -> Stufe-0-only, byte-identisch). Der MCP-native
      // Renderer ist der Default (siehe ui/registry.js); kein per-Request-Capability-Gate
      // mehr, weil der stateless Transport (sessionIdGenerator=undefined) die initialize-
      // Capabilities nicht zum tools/list-POST mitfuehrt - das Widget-_meta erschien sonst
      // NIE. capabilities dienen nur noch der expliziten ChatGPT-Adapter-Wahl. Kein neuer
      // Endpunkt, mcpAuth + res.on("close")-Cleanup unveraendert.
      const uiHost = { enabled: config.tenancy.mcpUiEnabled, capabilities: req.body?.params?.capabilities };
      registerTools(server, {
        identity,
        scopedTenant,
        allowCalendar: profile.allowCalendar,
        uiHost,
        language,
      });
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

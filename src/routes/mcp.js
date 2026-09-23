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
// mcpAuth (src/auth.js: Legacy-Bearer-Token, statisches Token oder OAuth 2.1) ist und
// bleibt die einzige IDENTITAETS-Pruefung auf POST, fail-closed (Default nur localhost).
// Seit E5 laeuft DAVOR mcpOriginOnlyMiddleware (s.u.): sie prueft die HERKUNFT
// (DNS-Rebinding-Schutz, MCP-Spec T-06), ersetzt mcpAuth NICHT und schwaecht sie nicht
// ab - es kommen strikt weniger Requests durch. GET/DELETE tragen weiter KEINE Auth
// (nur 405), laufen aber durch dieselbe Herkunftswache.
//
// T2-07 (T-28): POST /mcp traegt zwei eigene Zaehler statt des einen globalen IP-Limiters
// (src/mcp-rate-limit.js, in app.js gebaut, ueber deps.mcpDrosseln injiziert) - je Mandant
// statt je IP, damit ChatGPTs gemeinsame Egress-IPs Nutzer nicht gegenseitig drosseln.
// mcpAuth entsteht hier aus makeMcpAuth({ ablehnungsDrossel }); mandantDrossel (s.u.) laeuft
// NACH mcpAuth und VOR den Body-Parsern (deps.bodyParsers, dieselben Instanzen wie global
// in app.js) - ein Unauthentifizierter wird dadurch nie geparst (Pre-Mortem 2).
// Die stateless/pure Bausteine (McpServer,
// Transport, registerTools, HERMES_SERVER_INFO, mcpServerOptions, consultAllowedFor,
// hashEmail, ANON_IDENTITY) kommen direkt aus ihren Quellmodulen (G5 - wie
// normNum/localeFor in makeVoiceRoutes); nur config/store, der EINE requestTenant-
// Resolver (INV-7), die Drosseln und die Parser werden injiziert.
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

// deps: { config, store, requestTenant, mcpDrosseln, bodyParsers }. config = globales
// Config-Objekt (mcpUiEnabled). store traegt resolveProfile. requestTenant = die EINE
// Wurzel-Instanz (INV-7; loest den Tenant EINMAL aus dem verifizierten JWT auf und reicht
// ihn als X-Internal-Tenant weiter). mcpDrosseln = makeMcpDrosseln(...) (T2-07, in app.js
// gebaut). bodyParsers = dieselben zwei Parser-Instanzen wie im globalen Middleware-Stack
// (app.js), hier hinter mcpAuth statt davor.
// AL-P13: Diagnose-Label eines /mcp-Requests. Bis hierher stand nur die METHODE im Log -
// bei tools/call also 60-mal dasselbe Wort. Die Abnahme dieser Phase zaehlt, wie oft das
// Client-Modell await_call_event zieht; ohne den Werkzeugnamen ist sie nicht messbar.
// Ein Werkzeugname ist kein Geheimnis und keine PII (Regel 4); Argumente bleiben draussen.
export function mcpRequestLabel(body) {
  const method = body?.method || "";
  const toolName = method === "tools/call" ? body?.params?.name : null;
  return typeof toolName === "string" && toolName ? `${method} ${toolName}` : method;
}

const HTTP_FORBIDDEN = 403;

// T2-05 (T-14): Audit-Log fuer JEDEN Kein-Mandant-Fall, unabhaengig vom Auth-Modus -
// der forensische Pfad ("wer hat sich ohne Mandant gemeldet") bleibt fuer BEIDE
// Antwort-Zweige vollstaendig, nur die HTTP-Antwort unterscheidet sich (s.
// rejectIfNoTenant und die Registrierwahl im Handler). Wortlaut Bestand.
function auditNoTenant(scopedTenant, req) {
  if (scopedTenant !== TENANT_REJECT) return;
  audit("auth_failed", req, "path=/mcp grund=kein_tenant");
}

// E4-Torschluss: ein GUELTIGES Token ohne Tenant-Zuordnung kommt bis hierher bis an
// registerTools heran. Bewusst als eigene Funktion, aufgerufen IM Handler und NACH
// mcpAuth, nicht als vorgelagerte Middleware: die wuerde den Fall "kein Token" von 401
// auf 403 drehen, die Bearer-Challenge aus mcpAuth (src/auth.js) verschlucken und eine
// Neu-Autorisierung vom Client aus unmoeglich machen (der Aussperr-Fall, den E5 fuer die
// Herkunftswache benannt hat). Wortlaut identisch zu requireTenant (routes/_tenant.js) -
// EIN Text fuer EINE Lage. Liefert true, wenn der Handler abbrechen muss (Antwort bereits
// gesendet).
//
// T2-05 (T-14): sperrt NUR NOCH den Token-/Legacy-/off-Modus (kein req.auth - nur
// verifyOauth setzt es, src/auth.js). Der OAuth-Fall (req.auth gesetzt UND
// scopedTenant === TENANT_REJECT) bekommt HIER keine Sperre mehr: er laeuft weiter in
// den Handler und bekommt dort registerNoTenantStubs statt registerTools - eine
// Werkzeugliste mit Stub-Handlern, deren tools/call-Ergebnis die Re-Auth-Challenge im
// Ergebnis-_meta traegt (Pre-Mortem 2 PLAN-OPENAI-TECHNIK-2.md: die Bedingung haengt
// bewusst an req.auth, nicht nur an scopedTenant, damit ein Token-Aufrufer ueber die
// Interface-IP niemals eine Werkzeugliste bekommt).
function rejectIfNoTenant(scopedTenant, req, res) {
  if (scopedTenant !== TENANT_REJECT || req.auth) return false;
  res.status(HTTP_FORBIDDEN).json({ error: "Keine Tenant-Zuordnung fuer diese Identitaet." });
  return true;
}

// tenant=<id|reject|owner> auditiert die I4-Aufloesung (kein Secret: nur die tenantId,
// nie email/sub). E-Mail wird gehasht (T-P0-7): dieses Diagnose-Log laeuft pro Request
// und landet im Render-stdout - die Klartext-Adresse waere PII at rest. Der forensische
// Identitaets-Nachweis bleibt vollstaendig im audit()-Trail (requestedBy). Eigene Funktion
// (G30/G34): buendelt Logging + Identitaets-Aufloesung, EIN Zweck, aus dem Haupt-Handler
// herausgezogen, damit dessen Verzweigungszahl unter dem Komplexitaets-Limit bleibt.
function logAndResolveIdentity({ req, scopedTenant }) {
  if (req.auth)
    console.log(
      "[mcp]",
      req.auth.email ? hashEmail(req.auth.email) : "anonym",
      `tenant=${scopedTenant}`,
      mcpRequestLabel(req.body),
    );
  // Identitaet aus dem verifizierten JWT (req.auth). email bevorzugt, sonst sub. Sie wird
  // als X-Internal-Identity an die In-Process-Tools gereicht (Audit/requestedBy) - NICHT
  // mehr fuer das Rechteprofil. Kein req.auth (Legacy/localhost/stdio) -> null.
  return req.auth ? req.auth.email || req.auth.sub || ANON_IDENTITY : null;
}

// T2-01 Nachbau: Client-Klasse fuer ui.domain (chatgpt-egress.js) UND fuer die Owner-
// Messung loggen - NIEMALS req.ip selbst (Regel 4, PII). req.ip ist hinter "trust
// proxy" (app.js) aus X-Forwarded-For abgeleitet, dieselbe Ableitung wie ueberall sonst
// im Repo (routes/_tenant.js, middleware.js rateHit) - keine zweite IP-Quelle. Eigene
// Funktion (G30/G34): buendelt Klassifikation + Diagnose-Log, analog
// logAndResolveIdentity oben (EIN Zweck, aus dem Haupt-Handler herausgezogen).
function logAndDetectChatgptEgress(req) {
  const chatgptEgress = isChatGptEgressIp(req.ip);
  console.log("[mcp] client-class", chatgptEgress ? "chatgpt" : "andere");
  return chatgptEgress;
}

export function makeMcpRoutes({ config, store, requestTenant, mcpDrosseln, bodyParsers }) {
  const router = Router();
  // mcpAuth (Funktionsname PFLICHT - Routen-Inventar-Test) mit dem Ablehnungs-Zaehler
  // dieses Prozesses (T2-07/T-28). EINMAL gebaut, nicht pro Request.
  const mcpAuth = makeMcpAuth({ ablehnungsDrossel: mcpDrosseln.ablehnung });

  // T2-07 (T-28): Mandant EINMAL aufloesen (INV-7), NACH mcpAuth. In res.locals ablegen -
  // der Handler liest von dort statt requestTenant ein zweites Mal aufzurufen. Object.assign
  // statt direkter Zuweisung (Muster captureRawBody, src/app.js, P6/F2): res.locals GEHOERT
  // Express, nicht uns - die Mutation ist der vom Framework vorgesehene Weg, request-
  // gebundenen Zustand weiterzureichen. Nicht erlaubt -> 429 vor jedem Parse (dieselbe
  // Reihenfolge wie der Ablehnungs-Zaehler in mcpAuth: erst pruefen/aufloesen, dann zaehlen).
  function mandantDrossel(req, res, next) {
    const scopedTenant = requestTenant(req);
    Object.assign(res.locals, { scopedTenant });
    const { allowed, retryAfterS } = mcpDrosseln.mandant(req, { scopedTenant });
    if (!allowed) return respondTooManyRequests(res, { retryAfterS, body: RATE_LIMIT_BODY });
    next();
  }

  // ================= MCP ueber Streamable HTTP (Custom Connector) =================
  // Stateless: pro Request ein frischer Server+Transport (einfach & robust fuer den Prototyp).
  // Auth via mcpAuth-Middleware (src/auth.js): Legacy-Bearer-Token, statisches
  // Token oder OAuth 2.1 (MCP_AUTH). Fail-closed bleibt Default (nur localhost).
  //
  // E5 (MCP-Spec T-06): Herkunftswache VOR mcpAuth, PFADGEBUNDEN gemountet. Der Pfad ist
  // nicht Kosmetik - der Router haengt in src/app.js auf "/", ein router.use(guard) OHNE
  // Pfad saehe JEDEN Request des Gateways und wiese jede Browser-Route fremder Herkunft
  // ab (lokal auch das eigene Dashboard). Eine use-Schicht deckt POST, GET, DELETE, das
  // Auto-OPTIONS und jede spaeter ergaenzte Methode in einer Zeile (fail-closed). Die
  // Allowlist entsteht EINMAL hier, nicht pro Request; ihre Eingaben sind beim Boot
  // geprueft (boot-guard.angekuendigterOriginFindings).
  router.use(
    "/mcp",
    createMcpOriginGuard({
      erlaubteOrigins: mcpErlaubteOrigins({
        publicUrl: config.server.publicUrl,
        zusaetzlicheOrigins: config.safety.mcpAllowedOrigins,
      }),
      enforce: config.safety.mcpOriginEnforce,
    }),
  );

  // T2-06 (T-29): CORS NUR fuer byte-genau gelistete Origins, DIREKT nach der
  // Herkunftswache und VOR mcpAuth - ein Browser-Client mit gelistetem Origin muss den
  // 401-Bearer-Challenge-Header lesen koennen, um sich neu zu autorisieren
  // (sonst genau die Falle, wegen der das Notventil E-4 existiert). corsOrigins entsteht
  // aus DERSELBEN mcpErlaubteOrigins-Funktion wie die Wachen-Liste oben, aber OHNE
  // publicUrl: PUBLIC_URL ist same-origin und braucht kein CORS, und diese Konstruktion
  // macht corsOrigins per Bauart zu einer Teilmenge der Wachen-Liste - kein Origin
  // bekommt CORS-Header, der nicht auch die Wache passieren wuerde. Liste einmal hier
  // gebildet (nicht pro Request, wie bei der Wache oben). Kein PUBLIC_ROUTES-Eintrag
  // fuer diesen use-Layer (Begruendung: Kommentar in createMcpCors, src/middleware.js,
  // und PLAN-SECURITY.md) - der Inventar-Test sieht nur layer.route, keine use-Schichten.
  router.use(
    "/mcp",
    createMcpCors({
      corsOrigins: mcpErlaubteOrigins({ zusaetzlicheOrigins: config.safety.mcpAllowedOrigins }),
    }),
  );

  router.post("/mcp", mcpAuth, mandantDrossel, ...bodyParsers, async (req, res) => {
    // AM6: Tenant EINMAL aus dem verifizierten JWT aufgeloest (req.auth.sub) - seit T2-07
    // bereits in mandantDrossel (INV-7: genau EINE Aufloesung), hier nur noch gelesen und
    // an die In-Process-Tools weitergereicht (scopedTenant als X-Internal-Tenant), damit
    // der REST-Hop nicht aus der email-first Identitaet re-aufloest (sub/email-Divergenz).
    const scopedTenant = res.locals.scopedTenant;
    auditNoTenant(scopedTenant, req);
    if (rejectIfNoTenant(scopedTenant, req, res)) return;
    const identity = logAndResolveIdentity({ req, scopedTenant });
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
      // AL-P13: serverOptions traegt jetzt ZWEI Dinge (Capabilities + instructions) und
      // ist deshalb aus dem mcpUiEnabled-Ternary herausgeloest. T-21: instructions sind
      // IMMER gesetzt (mcp-server-info.js), auch wenn uiEnabled UND consultLoop aus sind -
      // der Basis-Block gilt dann fuer jeden Tenant. Der Rueckgabewert ist nie undefined.
      const consultLoop = consultAllowedFor(profile);
      const serverOptions = mcpServerOptions({
        uiEnabled: config.tenancy.mcpUiEnabled,
        consultLoop,
      });
      const server = new McpServer(HERMES_SERVER_INFO, serverOptions);
      // Rich-UI-Host-Hinweis: gegated NUR durch den Master-Schalter config.tenancy.mcpUiEnabled
      // (aus -> uiHost.enabled=false -> Stufe-0-only, byte-identisch). Seit T2-01 gibt es
      // genau einen Renderer (ui/registry.js, MCP-Apps-Standard fuer JEDEN Host) - kein
      // Capability-Feld mehr noetig, kein neuer Endpunkt, mcpAuth + res.on("close")-Cleanup
      // unveraendert.
      const uiEnabled = config.tenancy.mcpUiEnabled;
      // T2-01 Nachbau: NUR bei aktivem Master-Schalter ueberhaupt klassifizieren - der
      // Schalter aus heisst weiterhin byte-identisch (kein Widget, kein Resource-Read,
      // die Klassifikation waere reine Nebenwirkung ohne Konsumenten). chatgptEgress
      // reist ALS FELD AM uiHost mit, kein eigenes registerTools-Argument (uiHost und
      // chatgptEgress beschreiben denselben Host-Kontext, G32).
      const uiHost = {
        enabled: uiEnabled,
        chatgptEgress: uiEnabled ? logAndDetectChatgptEgress(req) : false,
      };
      // T2-05 (T-14): OAuth-Kein-Mandant registriert die Stub-Fassade
      // (registerNoTenantStubs, src/mcp-no-tenant.js) statt der echten Werkzeuge - EINE
      // Verzweigung, keine zweite Kopie des Aufrufs. scopedTenant erreicht diese Zeile
      // im OAuth-Kein-Mandant-Fall bereits als TENANT_REJECT (requestTenant); die Stub-
      // Fassade erzwingt ihn zusaetzlich intern (Pre-Mortem 1, nie null).
      const register = scopedTenant === TENANT_REJECT ? registerNoTenantStubs : registerTools;
      register(server, {
        identity,
        scopedTenant,
        allowCalendar: profile.allowCalendar,
        consultAllowed: consultLoop,
        uiHost,
        language,
      });
      // T-15: securitySchemes am Tool-Deskriptor - siehe src/mcp-security-schemes.js.
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

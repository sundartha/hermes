// Voice-Gateway: Twilio-Webhooks (Inbound/Outbound), Audio-Bridge (Realtime),
// MCP ueber Streamable HTTP (/mcp), REST-API fuer Dashboard & stdio-MCP.
// MUSS erste Importzeile bleiben (vor store.js) - globales Crash-Netz, ESM-Eval-Order (T-P0-07).
import "./process-guards.js";
import path from "path";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config, assertConfig } from "./config.js";
import * as store from "./store.js";
import {
  BOOTSTRAP_TENANT_ID,
  DEFAULT_PROVIDER,
  PROVIDER,
  NUMBER_STATUS,
  PROVISION_NUMBER_JOB,
  PROVISIONING_JOB_STATUS,
  USAGE_EVENT_KIND,
  KYC_OUTBOUND_MIN,
  tenantIdForSubject,
  normNum,
} from "./store/defaults.js";
import { findActiveNumber, hasActiveNumber } from "./store/views.js";
import { planSummarySms } from "./sms-summary.js";
import { agentTurn, summarizeCall, openingText } from "./claude.js";
import { metrics } from "./metrics.js";
import { LlmUnavailableError } from "./llm.js";
import { registerTools } from "./mcp-tools.js";
import { uiServerExtension } from "./ui/contract.js";
import { attachMediaBridge, MEDIA_PATH } from "./bridge.js";
import { createRateLimiter, securityHeaders, errorHandler } from "./middleware.js";
import { mcpAuth, registerWellKnown } from "./auth.js";
import { audit, safeEqual, hashEmail } from "./util.js";
import {
  voiceControl,
  messaging,
  voiceRenderer,
  inboundSignatureVerifier,
  providerFromHeaders,
  numberProvisioning,
} from "./telephony/registry.js";
import {
  say as sayD,
  gather as gatherD,
  hangup as hangupD,
  redirect as redirectD,
  stream as streamD,
} from "./telephony/directives.js";
import { localeFor, languageForCountry } from "./i18n/locales.js";
import { parseSpeakEvent, SPEAK_OUTCOME } from "./telephony/adapters/telnyx/speak-events.js";
import {
  registerTenant,
  setTenantIdentityIfAbsent,
  normalizePrivateNumber,
  requestNumber,
  recordProvisioningJob,
  markProvisioningJob,
  setTenantGeo,
  findNumber,
} from "./store/state-ops.js";
import { searchParamsForCountry, holdAmountForCountry } from "./telephony/provisioning-geo.js";
import { geoLookupAdapter } from "./geo/registry.js";
import { resolveOnboardCountry } from "./geo/resolve.js";
import { handleProvisionJob } from "./worker/provisioning.js";
import { requestNumberForPaidTenant } from "./billing/provision-trigger.js";
import { createQueue } from "./queue/registry.js";
import { stripeBilling } from "./billing/stripe.js";
import { flushMeters } from "./billing/meter.js";
import { ensureCustomer, bindCardFromSession } from "./billing/card-setup.js";
import { verifyStripeSignature, applyStripeWebhook } from "./billing/webhook.js";
import { E164, invalidText, validateAssistantContext } from "./routes/_validation.js";
import { makeReadRoutes } from "./routes/api-read.js";
import { makeSelfServiceRoutes } from "./self-service-routes.js";
import { makeProfileRoutes, validIdentity } from "./routes/api-profiles.js";
import { PLAN_CATALOG } from "./plans.js";
import {
  makeWebAuthRoutes,
  makeAdminRoutes,
  makeOidc,
  makeAccounts,
  makeSessions,
  webAuth,
  webAuthAllowPending,
  adminOnly,
} from "./web-auth.js";
import { makePortalStore } from "./store/portal.js";
import { makeAuditStore } from "./audit-store.js";
import { createPortalRunner } from "./portal-pool.js";
import { guardedBoot } from "./boot-guard.js";
import {
  makeRequestTenant,
  isTrustedLocalCaller,
  internalIdentity,
  OWNER_ID,
  ANON_IDENTITY,
  TENANT_REJECT,
} from "./request-tenant.js";

const app = express();
// Genau EIN vertrauenswuerdiger Proxy (Render). Nicht `true`: sonst kann jeder Client
// per X-Forwarded-For eine beliebige IP vortaeuschen.
app.set("trust proxy", 1);

// Eine Queue-Instanz pro Prozess (Konstruktion in der Naht, nicht im Handler; P15).
// Default In-Memory (deterministisch, drain-on-demand); QUEUE_BACKEND=pgboss wirft
// (deferred nach P8) -> kein still gestartetes No-op-Subsystem.
const provisioningQueue = createQueue();

// Request-Tenant-Resolver (rein, extrahiert nach src/request-tenant.js, A4): an den
// konkreten store gebunden (Factory-Muster wie makeSelfServiceRoutes - haelt das
// Resolver-Modul DB-frei und ohne server.js-Boot importierbar/unit-testbar). Der
// neue Web-Session-Zweig wertet req.tenant (gesetzt von webAuthMiddleware nach
// signiertem Cookie + gueltiger DB-Session) VOR der req.auth/MCP-Logik aus: die
// staerkere, jederzeit invalidierbare Identitaet gewinnt, fail-closed (-> TENANT_REJECT,
// nie Owner). Volle Begruendung im Modul-Doc von request-tenant.js. isTrustedLocalCaller/
// internalIdentity sowie OWNER_ID/ANON_IDENTITY/TENANT_REJECT kommen aus demselben
// Modul (oben importiert).
const { requestTenant, requireTenant } = makeRequestTenant(store);

app.use(securityHeaders);

// ---- Rate-Limit fuer alle Nicht-Twilio-Routen (vor Auth: bremst auch Brute-Force).
// /voice/* ist ausgenommen (kommt von Twilio, eigene Signaturpruefung), ebenso
// vertrauenswuerdige lokale In-Process-Aufrufe (interne MCP-Tools): echtes Loopback OHNE
// Proxy-Weiterleitung. NICHT per isLocalSocket allein - hinter Render erscheint auch
// externer Traffic als Loopback (-> sonst liefe das Limit fuer den ganzen Internet-
// Traffic ins Leere). isTrustedLocalCaller verlangt zusaetzlich kein X-Forwarded-For.
const rateLimiter = createRateLimiter(config.rateLimitPerMin);
app.use((req, res, next) => {
  if (req.path.startsWith("/voice") || isTrustedLocalCaller(req)) return next();
  rateLimiter(req, res, next);
});

// Body-Groesse begrenzen: kein Endpunkt braucht mehr als 100kb (Twilio-Webhooks
// und API-Payloads sind klein) - schuetzt vor Memory-Druck durch Riesen-Bodies.
const BODY_LIMIT = "100kb";
// Kunden-Portal (Self-Service-Shell). Ziel des Post-Login-Redirects UND der Basic-Auth-
// Exemption: ein frisch eingeloggter (suspendierter) Tenant landet hier (zeigt
// "Choose your plan"), NICHT auf "/" (Owner-Dashboard hinter Basic-Auth = Sackgasse).
const CUSTOMER_PORTAL_PATH = "/tenant.html";
// P5: Ziel des Landing-Redirects (kein Magic-String, G25). "/" hat kein Index ->
// 302 auf den Login (= Registrierung, Strategie R2). Pfad lebt auf dem Gateway
// (makeWebAuthRoutes GET /auth/login), nicht auf der Static Site.
const LOGIN_PATH = "/auth/login";
// Single-Origin (P1): App-Shell-Pfad im apps/web-Build (kein Magic-String, G25). Ziel
// des Post-Login-Redirects UND des /tenant.html-Altpfad-Redirects, sobald WEB_DIST_DIR
// aktiv ist (das Tenant-Dashboard lebt dann unter /app im unified Build).
const APP_PATH = "/app";
// W4: Stripe-Webhook-Pfad (kein Magic-String, G25). Die HMAC-Signaturpruefung braucht
// den unveraenderten Roh-Body -> wird zusaetzlich zu /voice erfasst (s. captureRawBody).
const STRIPE_WEBHOOK_PATH = "/webhooks/stripe";
// rawBody fuer /voice (Twilio/Telnyx) UND den Stripe-Webhook erfassen: beide pruefen
// gegen den unveraenderten Body. Der Twilio-HMAC nutzt weiterhin nur die geparsten
// Params - die Erfassung aendert das Parsen NICHT (verify laeuft VOR dem Parsen, additiv).
const captureRawBody = (req, _res, buf) => {
  if (req.path.startsWith("/voice") || req.path === STRIPE_WEBHOOK_PATH) req.rawBody = buf;
};
app.use(express.urlencoded({ extended: false, limit: BODY_LIMIT, verify: captureRawBody })); // Twilio-Webhooks
app.use(express.json({ limit: BODY_LIMIT, verify: captureRawBody })); // eigene API + MCP

// Body-Parser-Fehler (413 zu gross, 400 kaputtes JSON) als JSON statt HTML beantworten
app.use((err, _req, res, next) => {
  if (!err.status || err.status < 400 || err.status >= 500) return next(err);
  res.status(err.status).json({ error: err.type || "bad request" });
});

// ---- Basic-Auth fuer Dashboard + API (Public Hosting). Ausgenommen:
// /voice/* (eigene Twilio-Signaturpruefung), /mcp (eigene MCP-Auth),
// /.well-known/* (OAuth-Metadata, muss ohne Login erreichbar sein),
// /healthz (Keep-Alive) und vertrauenswuerdige lokale In-Process-Aufrufe (interne
// MCP-Tools, isTrustedLocalCaller - NICHT per Socket-Adresse allein, s.u.).
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ---- GET /api/plans: oeffentlicher, read-only Plan-Katalog (BK0) -------------
// AUTH-AUSNAHME (Regel 3, begruendet): bewusst VOR der Basic-Auth gemountet, ohne
// Login erreichbar - exakt wie /healthz. Liefert NUR den oeffentlichen Tarif-Katalog
// (Preise/Leistungen, identisch zu www.sundartha.com/preise) - KEINE Tenant-Daten,
// KEINE Secrets, KEINE PII, kein Schreibpfad. SSoT: src/plans.js (Marketing-Spiegel
// apps/web/src/lib/plans.js, drift-getestet). BK1 (Dashboard-Kacheln) konsumiert ihn.
app.get("/api/plans", (_req, res) => res.json(PLAN_CATALOG));

registerWellKnown(app);

// P5: "/" hat kein Index (public/ traegt nur tenant.html) -> ginge sonst auf 404 bzw. die
// Owner-Basic-Auth-Sackgasse. 302 auf den Login (= Registrierung, Strategie R2). VOR der
// Basic-Auth + express.static gemountet wie /auth/*; traegt keine Tenant-Daten, braucht
// keine Session - daher unkonditional (greift auch ohne Web-Login-Infra).
// Single-Origin (P1): mit WEB_DIST_DIR faellt "/" bewusst durch auf die statische
// Marketing-index.html (dist/index.html, weiter unten gemountet) -> der Landing-Redirect
// gilt nur OHNE den unified Build (byte-identisch zum Bestand).
if (!config.webDistDir) {
  app.get("/", (_req, res) => res.redirect(302, LOGIN_PATH));
}

// ---- OIDC-Browser-Login (/auth/*) -----------------------------------
// Nur aktiv wenn sessionSecret UND pg-Backend gesetzt: ohne DB kein Session-Store,
// ohne Secret keine Cookie-Signatur. Muss VOR Basic-Auth und express.static liegen,
// damit /auth/login nicht durch Basic-Auth geblockt wird.
if (config.sessionSecret && config.storeBackend === "pg") {
  // AC5 (Boot-Entkopplung): der gesamte Portal-/Web-Login-Block laeuft in guardedBoot.
  // Wirft createPortalRunner (F5-Rollen-Assertion ODER Portal-DB unerreichbar) oder ein
  // Wiring-Schritt, faengt guardedBoot es laut + secret-frei ab -> die Web-Login/Portal-
  // Routen werden NICHT gemountet (existieren nicht -> 404), aber der Boot laeuft weiter:
  // /voice, /healthz, /mcp und das Owner-Dashboard (Basic-Auth NACH diesem Block) bleiben.
  // Portal-pg-Fail toetet die Telefonie also nicht mehr.
  await guardedBoot("Web-Login/Portal", async () => {
    const portalRunner = await createPortalRunner();
    const oidc = makeOidc(config);
    const accounts = makeAccounts(portalRunner);
    const sessions = makeSessions(portalRunner);
    const auditStore = makeAuditStore(portalRunner);
    const portalStore = makePortalStore(portalRunner);
    const webAuthMw = webAuth({ secret: config.sessionSecret, sessions, accounts });
    // P5: pending-Variante fuer die Self-Aktivierungs-Routen (suspended erreichbar, sonst
    // 403-Deadlock). Gleiche Session-Mechanik, nur das Status-Gate ist gelockert (web-auth.js).
    const webAuthPendingMw = webAuthAllowPending({
      secret: config.sessionSecret,
      sessions,
      accounts,
    });
    const adminMw = adminOnly({ adminEmails: config.adminEmails });
    // P2b: Vor-/Nachname aus dem verifizierten IdP-Profil set-if-absent in den Gate-Store
    // schreiben (gleiche Kompositions-Quelle wie /api/onboard: applyOwnerIdentity ueber
    // setTenantIdentityIfAbsent + Store-Lock, G5). FAIL-OPEN wie ensureTenant: ein Store-
    // Schluckauf darf den Login NICHT blocken -> Folge ist ein eingeloggter Tenant ohne
    // ownerName, den das Outbound-Identitaets-Gate fail-CLOSED sperrt (kein Leak). save()
    // NUR bei echter Mutation (set-if-absent: Folge-Logins = No-Op). Kein Secret im Log.
    const applyTenantIdentity = async (tenantId, identity) => {
      try {
        await store.withStoreLock(() => {
          const s = store.load();
          if (setTenantIdentityIfAbsent(s, tenantId, identity)) store.save();
        });
      } catch (e) {
        console.error("[web-auth] applyTenantIdentity fehlgeschlagen:", e.message);
      }
    };
    const loginRateLimiter = createRateLimiter(config.loginRateLimitPerMin);
    app.use("/auth", loginRateLimiter);
    app.use(
      makeWebAuthRoutes({
        secret: config.sessionSecret,
        redirectUri: config.publicUrl + "/auth/callback",
        ttlSeconds: config.sessionTtlSeconds,
        // Login-Flow-Cookie-TTL (state/pkce/nonce), separat von der Session-TTL: grosszuegig
        // genug fuer den Mail-Verify-Round-Trip; Ablauf faengt die Callback-Recovery benign ab.
        loginCookieTtlSeconds: config.loginCookieTtlSeconds,
        oidc,
        accounts,
        sessions,
        audit: auditStore,
        // Post-Login ins Kunden-Portal NUR wenn die Self-Service-Shell gemountet ist
        // (gleicher Flag-Gate wie die /tenant.html-Basic-Auth-Exemption unten). Sonst
        // Default "/" -> byte-identisch zum Bestand (kein Redirect auf eine Seite, die
        // ohne Self-Service-Flags nicht Basic-Auth-exempt waere).
        // Single-Origin (P1): mit WEB_DIST_DIR landet der frisch eingeloggte Tenant auf
        // der App-Shell (/app) im unified Build (vorrangig vor dem Self-Service-Portal).
        postLoginPath: config.webDistDir
          ? APP_PATH
          : config.selfServiceEnabled && config.multiTenant
            ? CUSTOMER_PORTAL_PATH
            : undefined,
        // Lokaler Dev-Login-Shim (NUR mit config.devLoginEnabled, fail-closed): mintet
        // dieselbe Session wie der echte Callback fuer den Chrome-e2e-Loop ohne WorkOS.
        devLoginEnabled: config.devLoginEnabled,
        // Signup-Spiegel-Nachzug: zieht den per accounts.upsertOnFirstLogin (mintSession)
        // frisch angelegten Tenant in den pg-Store-Spiegel, BEVOR der Self-Service-Subscribe-
        // Pfad eine WRITE-Store-Op (setTenantStripe etc.) ausloest, die ihn sonst nicht faende.
        ensureTenant: (tid) => store.ensureTenant(tid),
        // P2b: Identitaets-Write (Vor-/Nachname aus dem verifizierten IdP-Profil) ueber die
        // Fassade in den Gate-Store - sonst sperrt das Outbound-Identitaets-Gate den Web-Tenant.
        applyTenantIdentity,
      }),
    );

    // Kunden-Portal (READ-only, tenant-scoped ueber portalStore). webAuthMw setzt
    // req.tenant (fail-closed); portalStore.withTenant erzwingt RLS. KEINE Owner-Daten.
    // VOR der Basic-Auth-Schicht registriert -> /api/portal/* ist owner-Basic-Auth-
    // exempt und ausschliesslich ueber webAuth (Kunden-Session) gesichert.
    app.get("/api/portal/state", webAuthMw, async (req, res) => {
      try {
        const calls = await portalStore.listCalls(req.tenant.tenantId);
        res.json({ tenantId: req.tenant.tenantId, calls });
      } catch (e) {
        console.error("[portal] state", e.message);
        res.status(500).json({ error: "interner Fehler" });
      }
    });

    // ---- Admin: Tenant freigeben / suspendieren (admin-allowlist, fail-closed) ----
    // Routen-Handler in makeAdminRoutes (web-auth.js), damit der Test exakt denselben
    // Handler prueft statt einer Replik (G5). suspend invalidiert sofort alle Sessions
    // des Tenants; jede Aktion auditiert; nicht-existenter Tenant -> 404.
    app.use(makeAdminRoutes({ accounts, sessions, audit: auditStore, webAuthMw, adminMw }));

    // ---- Self-Service (I9 + #3): web-session-only, hinter webAuthMw ----------------
    // Konvergenz #3: Self-Service haengt jetzt am echten OIDC-Browser-Login statt am
    // X-Internal-Identity-Pfad. NUR hier (im Web-Login-Block: sessionSecret + pg)
    // registriert -> ohne Web-Login-Infra existieren die Routen nicht (404). Zusaetzlich
    // an SELF_SERVICE_ENABLED + MULTI_TENANT gegated (eigenes Reife-Flag; ohne
    // MULTI_TENANT keyt der Mirror nur den Owner-Bucket). VOR der Basic-Auth-Schicht ->
    // ausschliesslich ueber webAuthMw (Kunden-Session) gesichert, kein Admin-Basic-Auth.
    // audit = util.audit (nur Keys, keine Werte/PII).
    if (config.selfServiceEnabled && config.multiTenant) {
      app.use(
        makeSelfServiceRoutes({
          store,
          webAuthMw,
          webAuthPendingMw,
          audit,
          config,
          billing: stripeBilling,
          accounts,
          provision: triggerTenantProvisioning,
        }),
      );
    }

    // ---- Stripe-Webhook (W4): Abo-Lifecycle nachziehen ------------------------------
    // KEINE Basic-Auth (Stripe kann keine Credentials senden) - die Sicherung ist die
    // HMAC-Signaturpruefung gegen STRIPE_WEBHOOK_SECRET (fail-closed, eigener Begruendungs-
    // Kommentar wie /voice, Regel 3). Ohne PAYMENT_ENABLED -> 404 (byte-identisch).
    // Liegt im guardedBoot-Block, weil applyStripeWebhook accounts.setStatus +
    // sessions.invalidateByTenant braucht (nur hier konstruiert). Idempotent: jeder
    // Event wirkt nur als Vorwaerts-Zustand; Wiederholung aendert nichts.
    app.post(STRIPE_WEBHOOK_PATH, async (req, res) => {
      if (!config.paymentEnabled) return res.status(404).json({ error: "payment disabled" });
      const ok = verifyStripeSignature({
        rawBody: req.rawBody,
        signatureHeader: req.headers["stripe-signature"],
        secret: config.stripeWebhookSecret,
        nowS: Math.floor(Date.now() / 1000),
      });
      if (!ok) {
        audit("stripe_webhook_rejected", req, "signature");
        return res.status(400).json({ error: "invalid signature" });
      }
      // rawBody ist verifiziert -> jetzt erst parsen (kein Vertrauen vor der Signatur).
      let event;
      try {
        event = JSON.parse(req.rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "bad payload" });
      }
      await applyStripeWebhook(event, {
        store,
        accounts,
        sessions,
        audit,
        req,
        provision: triggerTenantProvisioning,
      });
      res.json({ received: true });
    });
  });
}

// ---- Single-Origin: apps/web (Astro-Build) statisch ausliefern (WEB_DIST_DIR) ----
// Hinter dem Pfad-Flag (leer = aus -> heutiges Serving byte-identisch). MUSS VOR der
// Basic-Auth (unten) liegen, SONST verlangte die oeffentliche Marketing-Site das
// Admin-Passwort.
// AUTH-AUSNAHME (Regel 3, begruendet): Marketing-Seiten + die /app-Shell sind bewusst
// oeffentlich - statisches HTML/JS OHNE Tenant-Daten. Jede Tenant-Sicht laedt ihre Daten
// erst ueber /api/self-service/* (webAuthMw, active-only, Session-Cookie) -> kein
// Datenleck ueber das statische Serving. /api/*, /auth/*, /.well-known/*, der Stripe-
// Webhook und /healthz sind oben bereits gematcht (Mount-Reihenfolge) -> kein Shadowing;
// die Owner-Legacy-API liegt HINTER der Basic-Auth (unten) -> von diesem Mount unberuehrt.
if (config.webDistDir) {
  // /tenant.html -> /app: schattet die public/tenant.html (Owner-Removal-Altpfad) und
  // erhaelt alte Bookmarks - das Tenant-Dashboard lebt im Build unter /app. P2/D2: den
  // Query-String ERHALTEN. Der Post-Checkout-Rueckkehrpfad landet auf /tenant.html?sub=ok
  // bzw. ?card=ok (self-service-routes.js); ohne Weitergabe ginge der Parameter beim
  // Redirect verloren und die BillingIsland (?sub/?card-Handler) saehe ihn nie. Nur den
  // Such-Teil anhaengen (kein Query -> reines /app, byte-identisch zum Altverhalten).
  app.get(CUSTOMER_PORTAL_PATH, (req, res) => {
    const queryAt = req.originalUrl.indexOf("?");
    const search = queryAt === -1 ? "" : req.originalUrl.slice(queryAt);
    res.redirect(302, APP_PATH + search);
  });
  // Statische Marketing-Site + App-Shell. extensions:["html"] loest /preise -> preise.html
  // auf; "/" liefert dist/index.html, /app -> app/index.html (express.static-Index-Default).
  app.use(express.static(config.webDistDir, { extensions: ["html"] }));
  // SPA-Fallback: Unterpfade unter /app liefern die App-Shell (Client-seitiges Routing).
  app.get("/app/*", (_req, res) =>
    res.sendFile(path.join(config.webDistDir, "app", "index.html")),
  );
}

app.use((req, res, next) => {
  if (!config.dashboardPassword) return next();
  // Self-Service-Seite (I9 + #3) ist die GETRENNTE Tenant-Sicht: NICHT hinter der
  // Admin-Basic-Auth. Nur die statische HTML-Seite ist frei - sie enthaelt KEINE
  // Tenant-Daten (die kommen ueber /api/self-service/*, abgesichert per webAuthMw +
  // Session-Cookie aus dem OIDC-Browser-Login, nicht mehr per Bearer-Paste).
  // Hinter den Flags (Self-Service + MULTI_TENANT): aus -> nicht ausgenommen ->
  // byte-identisch zum Bestand.
  if (config.selfServiceEnabled && config.multiTenant && req.path === CUSTOMER_PORTAL_PATH)
    return next();
  // /webhooks/stripe ist Basic-Auth-exempt: Stripe kann KEINE Basic-Auth-Credentials
  // senden. Die Sicherung ist die HMAC-Signaturpruefung gegen STRIPE_WEBHOOK_SECRET
  // (fail-closed, Regel 3) - exakt analog zu /voice (Twilio-/Telnyx-Signatur). Zusaetzlich
  // PAYMENT_ENABLED-gegated (aus -> 404). Der Handler liegt im guardedBoot-Block (braucht
  // accounts/sessions), die Exemption hier ist die Basic-Auth-Vorschaltung.
  if (
    req.path.startsWith("/voice") ||
    req.path.startsWith("/mcp") ||
    req.path.startsWith("/.well-known") ||
    req.path === STRIPE_WEBHOOK_PATH ||
    req.path === "/healthz"
  )
    return next();
  // Genuiner lokaler In-Process-Aufrufer (MCP-Tools rufen die eigene /api ueber
  // http://localhost) ist von der Basic-Auth ausgenommen. NICHT per Socket-Adresse
  // allein: hinter Render ist auch externer Traffic Loopback -> das oeffnete Dashboard
  // + API ohne Passwort fuer das ganze Internet (AM1, empirisch bestaetigt).
  // isTrustedLocalCaller verlangt zusaetzlich KEIN X-Forwarded-For (Proxy-Weiterleitung).
  if (isTrustedLocalCaller(req)) return next();
  const expected = "Basic " + Buffer.from("admin:" + config.dashboardPassword).toString("base64");
  if (safeEqual(req.headers.authorization || "", expected)) return next();
  audit("auth_failed", req, `path=${req.path}`);
  res.set("WWW-Authenticate", 'Basic realm="Hermes"');
  res.status(401).send("Auth required");
});
app.use(express.static(config.publicDir));

// ---- Inbound-Signaturpruefung fuer alle /voice-Webhooks (fail-closed) ----
// Der Provider signiert jeden Request. Ohne diese Pruefung kann jeder, der die URL
// kennt, Anrufe/Transkripte faelschen und Claude-Turns (=Kosten) ausloesen. Die
// Krypto (Twilio-HMAC) lebt im Adapter; hier bleibt nur das Skip-Gate (Local/Test)
// und die fail-closed-Antwort. rawBody (req.rawBody) ist fuer kuenftige Provider da.
app.use("/voice", (req, res, next) => {
  if (config.skipTwilioSignatureCheck) return next();
  const ok = inboundSignatureVerifier().verifyInboundSignature({
    headers: req.headers,
    rawBody: req.rawBody,
    url: config.publicUrl + req.originalUrl,
    params: req.body || {},
  });
  if (!ok) return res.status(403).send("invalid inbound signature");
  next();
});

// Kurz-Helfer fuer Direktiven-Listen -> Provider-Markup (TwiML/TeXML). provider
// wird vom Aufrufer durchgereicht; undefined -> voiceRenderer-Default twilio ->
// jeder arg-lose render(x)-Aufruf bleibt byte-identisch (Hot-Path, R5).
const render = (directives, provider) => voiceRenderer(provider).renderDirectives(directives);

// normNum (E.164-Normalisierung) lebt zentral in store/defaults.js (EINE Quelle,
// geteilt mit Seed + Profil-Allowlist) und wird oben importiert.

// Provider-bewusstes Auslesen des Speech-Ergebnisses aus dem Webhook-Body.
// Twilio sendet `SpeechResult`. Telnyx: laut TeXML-Doku `Transcript`, real zeigen die
// Turn-Posts (Live-Beleg 2026-06-20) aber `SpeechResult` (und KEIN `Transcript`) -
// daher defensiv BEIDE lesen, damit der Agent den erkannten Text nutzt, egal in welchem
// Feld Telnyx ihn liefert (sonst hoert der Agent trotz korrekter STT nichts -> Stille).
function extractSpeech(req, provider) {
  if (provider === "telnyx") return (req.body.Transcript || req.body.SpeechResult || "").trim();
  return (req.body.SpeechResult || "").trim();
}

// PII-freie Sanitisierung eines Telnyx-Hangup-Tokens fuers Log (defensiv, analog
// safeReason in adapters/telnyx/speak-events.js). HangupCause ("normal_clearing"),
// HangupSource ("caller"/"callee") und SipHangupCause (SIP-Code, z.B. "486") sind
// kurze Enums/Codes, NIE Telefonnummern/Namen. Trotzdem nie ungefiltert ins Log:
// nur ein kurzes Token aus einer Zeichen-Allowlist (alnum, _ . : -) bis 48 Zeichen
// wird uebernommen; alles andere (Freitext, E.164-Nummern mit "+", zu lang)
// -> undefined -> kein Diagnose-Feld. BEWUSST OHNE Space: Telnyx liefert diese
// Felder als snake_case-Enum, festes Token oder numerischen SIP-Code (nie mit
// Leerzeichen), also weist die Allowlist Mehrwort-Freitext (theoretischer ASCII-
// Klarname) zusaetzlich ab. So bleibt das Log byte-knapp und PII-frei.
const SAFE_CAUSE_TOKEN = /^[A-Za-z0-9_.:-]{1,48}$/;
function safeCauseToken(value) {
  if (typeof value !== "string") return undefined;
  const token = value.trim();
  return SAFE_CAUSE_TOKEN.test(token) ? token : undefined;
}

// Provider-bewusstes Auslesen des Call-Lifecycle-Status aus dem StatusCallback-Body
// (analog extractSpeech). Beide Provider senden PascalCase-Felder (CallStatus,
// CallDuration) als form-encoded POST. Telnyx liefert zusaetzlich Diagnose-Felder:
// CallDuration (Sekunden) und beim "Call Completed"-Callback die Hangup-Ursache
// (HangupCause/HangupSource/SipHangupCause - Feldnamen aus der Telnyx-OpenAPI-Spec
// texml/calls.yml, TexmlCallCompletedWebhookSchema). Twilio sendet diese nicht ->
// diagnostics bleibt fuer Twilio leer (byte-identisch zum Bestand). diagnostics ist
// bewusst PII-frei (nur Zahlen + sanitisierte Tokens, NIE From/To/Nummern). Garbage/
// fehlende Felder -> kein Diagnose-Feld (kein NaN, kein leeres/unsauberes Token).
function extractLifecycleEvent(req, provider) {
  const status = req.body.CallStatus;
  if (provider !== PROVIDER.TELNYX) return { status, diagnostics: {} };
  const durationS = parseInt(req.body.CallDuration, 10);
  const diagnostics = {};
  if (Number.isFinite(durationS)) diagnostics.callDurationS = durationS;
  const hangupCause = safeCauseToken(req.body.HangupCause);
  const hangupSource = safeCauseToken(req.body.HangupSource);
  const sipHangupCause = safeCauseToken(req.body.SipHangupCause);
  if (hangupCause) diagnostics.hangupCause = hangupCause;
  if (hangupSource) diagnostics.hangupSource = hangupSource;
  if (sipHangupCause) diagnostics.sipHangupCause = sipHangupCause;
  return { status, diagnostics };
}

// Provider-bewusstes Erkennen eines Telnyx-"Speak"-Command-Events (server-seitiges TTS
// via TeXML-<Say> ueber Azure-NTTS) im Webhook-Body (analog extractSpeech/extract-
// LifecycleEvent). Twilio kennt diese Events nicht -> immer NONE (Hot-Path byte-
// identisch). Die Telnyx-Event-Namen + die PII-freie Klassifikation leben im Adapter
// (parseSpeakEvent, rein/testbar); hier nur der Provider-Dispatch.
function extractSpeakOutcome(req, provider) {
  if (provider !== PROVIDER.TELNYX) return { outcome: SPEAK_OUTCOME.NONE, reason: null };
  return parseSpeakEvent(req.body);
}

// ---- Eingabe-Validierung fuer API-Routen ----
// E164, TEXT_LIMITS, invalidText: extrahiert nach src/routes/_validation.js (T4 Phase 2).

// ---- Nummern-Gates fuer Outbound-Calls (Safety, siehe tasks/todo.md Phase 0+2) ----
// Feste Pruefreihenfolge: Denylist -> E.164 -> Laender-Gate -> Pro-Stunde-Limit
// -> Verifikations-Gate (Pfad 0-2; statische ALLOWED_NUMBERS abgeschafft, outbound-p3).
// Die Denylist laeuft BEWUSST vor der Formatpruefung: so erscheint eine Notruf-Kurzwahl
// (112) als bewusste Sperre (403 denylist) und nicht als Formatfehler (400).
//
// Rechteprofile (Phase 2): das Profil kann das Land-Gate NUR weiter einschraenken
// (Schnittmenge global ∩ profil), das Stundenlimit NUR senken (min global/profil)
// und das Verifikations-Gate lockern (unrestricted/eigene Liste). Denylist, Land-Obergrenze,
// globales Stundenlimit, Budget und Max-Dauer bleiben harte globale Obergrenzen.
//
// Abo-Kopplung (W5, Tenant-Achse): ein AKTIVER, KYC-verifizierter Subscriber gilt im
// Verifikations-Gate als freigegeben (das Abo IST die Outbound-Freigabe); ein
// suspendierter/geschlossener Tenant wird dort HART abgewiesen (Defense-in-depth). Beides
// wirkt NUR innerhalb des Verifikations-Gates und lockert KEIN hartes Gate davor. Der Owner traegt
// seit Phase outbound-p1 ein EXPLIZITES kyc_level (id_verified, via seedBootstrapKyc beim Boot)
// und gilt als aktiver Subscriber (Pfad 2). Eine statische ALLOWED_NUMBERS-Liste gibt es seit
// outbound-p3 nicht mehr; die globale Notbremse ist OUTBOUND_FROZEN (ganz vorn in POST /api/calls).
//
// Hardcoded (kein Env, nicht abschaltbar): Notruf-Kurzwahlen exakt (sonst wuerde
// "112" auch legitime Nummern als Prefix treffen), Premium-/Service-Prefixe per
// startsWith. Eng gefasst, damit normale Mobilnummern (+4915...) durchkommen.
const EMERGENCY_SHORT_CODES = ["110", "112", "911", "999"];
// Globale Best-effort-IRSF-Blockliste (outbound-p1b): die hoechsten Premium-/Satelliten-/
// IPRN-Risiko-Ziele weltweit. BEWUSST unvollstaendig - bei weltweiter Reichweite ('*',
// Phase 4) ist sie Beifang, NICHT der Hauptschutz (Hauptschutz = Kosten-Achse/Pre-Auth,
// Phase 1c). Strikt SUB-Ranges (Premium/Service/Satellit/IPRN), NIE ganze Laendercodes -
// eine gewoehnliche US-/ES-/DE-Mobilnummer muss durchkommen. Periodisch gegen eine
// gepflegte IRSF-Quelle aktualisieren. Quelle/Zweck je Gruppe im Kommentar.
const PREMIUM_PREFIXES = [
  // Satellit (Inmarsat / globale Mobil-Satellit) - sehr hohe Minutenpreise, IRSF-Liebling
  "+870",
  "+881",
  "+882",
  "+883",
  // IPRN (International Premium Rate Numbers)
  "+979",
  // DE Premium/Service: 0900 (Premium, kurz + lang), 0137 (Televoting), 0180 (Shared-Cost),
  // 0118 (Auskunft), 0700 (persoenliche Rufnummer, Restschuld)
  "+49900",
  "+490900",
  "+49137",
  "+49180",
  "+49118",
  "+49700",
  // UK Premium/Service: 118 (Directory Enquiries), 070 (Personal/Follow-me), 09 (Premium),
  // 084x/087x (Service)
  "+44118",
  "+4470",
  "+449",
  "+44843",
  "+44844",
  "+44845",
  "+44870",
  "+44871",
  // FR Premium/Service: 118 (Auskunft), 089x (audiotel/SVA Premium), 081x/082x (Service)
  "+33118",
  "+33899",
  "+33892",
  "+33810",
  "+33820",
];
const HOUR_MS = 60 * 60 * 1000;
const SECONDS_PER_MINUTE = 60;

const isDenied = (to) =>
  EMERGENCY_SHORT_CODES.includes(to) || PREMIUM_PREFIXES.some((p) => to.startsWith(p));
const matchesPrefix = (to, codes) => codes.includes("*") || codes.some((c) => to.startsWith(c));

// Worst-Case-Minutentarif (GANZZAHL Cents/min) des Ziels (outbound-p1c, Kosten-Achse).
// EINE Kosten-Quelle (G5): Vorab-Reservierung, Budget-Reconcile UND Stripe-Voice-Meter.
// Inlands-Vorwahl -> guenstiger Inlandstarif, alles andere -> Worst-Case-Default. to ist an
// der Aufrufstelle bereits E.164-validiert (numberGateError). Prefix-Match wie matchesPrefix.
function tariffCentsPerMin(to) {
  return config.voiceTariffDomesticPrefixes.some((p) => to.startsWith(p))
    ? config.voiceTariffDomesticCents
    : config.voiceTariffDefaultCents;
}

// Land-Gate: Schnittmenge global ∩ profil. Ein Profil kann nur WEITER einschraenken,
// nie ueber die globale Erlaubnis hinaus (Profil "*"/leer = keine Zusatz-Einschraenkung).
function countryGateAllowed(to, profile) {
  if (!matchesPrefix(to, config.allowedCountryCodes)) return false;
  const p = profile.allowedCountryCodes;
  return !p || !p.length || matchesPrefix(to, p);
}

const hourWindowStart = () => new Date(Date.now() - HOUR_MS).toISOString();
// Globales Stundenlimit ueber ALLE Outbound-Calls (Plattform-Notbremse, Bestand,
// wird nie entfernt). Tenant-unabhaengig (ohne Filter = alle Calls).
const globalHourReached = () =>
  store.countOutboundCallsSince(hourWindowStart()) >= config.maxCallsPerHour;
// Pro-Nutzer-Stundenlimit: effektiv min(global, profil) - ein Profil kann nur senken.
function userHourReached(profile, requestedBy) {
  const limit =
    profile.maxCallsPerHour == null
      ? config.maxCallsPerHour
      : Math.min(config.maxCallsPerHour, profile.maxCallsPerHour);
  return store.countOutboundCallsSince(hourWindowStart(), { requestedBy }) >= limit;
}

// Cooldown-Fensterstart fuer den per-(Tenant,Ziel)-Cap (outbound-p1d). Eigenes Fenster
// (config.perTargetWindowMs) - die Stundenlimits oben nutzen hourWindowStart.
const perTargetWindowStart = () =>
  new Date(Date.now() - config.perTargetWindowMs).toISOString();
// Per-(Tenant,Ziel)-Wiederhol-Cap (outbound-p1d, D4, Belaestigungs-Bremse, Schutz Dritter):
// wie oft DIESER Tenant DASSELBE Ziel im Cooldown-Fenster schon angerufen hat; ab dem Cap
// gesperrt. Tenant-isoliert (Filter tenantId) + ziel-isoliert (Filter to). Zaehlt - wie die
// Stundenlimits - bewusst auch fehlgeschlagene Calls (konservativ). Cap 0 -> jeder Outbound
// gesperrt (Not-Aus, wie maxCallsPerHour=0).
function perTargetCapReached(tenantId, to) {
  return (
    store.countOutboundCallsSince(perTargetWindowStart(), { tenantId, to }) >=
    config.perTargetCallCap
  );
}

// Verifikations-Gate (letztes Gate): mehrere Freigabe-Pfade, ALLE optional - schlaegt keiner
// an, wird fail-closed abgewiesen (outbound-p3: keine statische ALLOWED_NUMBERS mehr).
// Reihenfolge load-bearing:
//   0. Defense-in-depth (W5): suspendierter/geschlossener Tenant -> HART 403, VOR jeder
//      Lockerung (ein gueltiges profile.unrestricted hebt das BEWUSST NICHT auf). Abo
//      gekuendigt / Zahlung gescheitert -> kein freies Waehlen mehr, unabhaengig von der
//      Stripe-Webhook-Session-Invalidierung (belt-and-suspenders).
//   1. Admin-Override (Bestand): profile.unrestricted ODER Ziel in profile.allowedNumbers
//      (Testaccounts, gezielte Freigabe) -> freigegeben.
//   2. Abo-Kopplung (W5): aktiver, KYC-verifizierter Subscriber -> freigegeben (das Abo IST
//      die Freigabe). Der Owner traegt seit Phase outbound-p1 ein EXPLIZITES kyc_level
//      (id_verified, Boot-Seed seedBootstrapKyc) und faellt hierunter (Pfad 2); ein
//      ungeseedeter Fremd-Tenant ohne kyc_level NICHT (tenantActiveSubscriber false).
//   3. Sonst fail-closed Deny - keine statische Liste mehr (outbound-p3); die globale
//      Notbremse ist OUTBOUND_FROZEN (ganz vorn in POST /api/calls).
// Hebt NUR dieses Gate auf; alle harten Gates davor (Denylist/Land/Limit) liefen schon.
// caller = aufgeloeste Aufrufer-Identitaet (profile = Rechte-Achse, tenantId = Tenant-Achse).
function allowlistError(to, { profile, tenantId }) {
  if (store.tenantInactive(tenantId))
    return {
      status: 403,
      grund: "abo",
      message: "Abo inaktiv (Tenant gesperrt). Outbound-Anrufe sind gesperrt.",
    };
  if (profile.unrestricted) return null;
  if (profile.allowedNumbers?.includes(to)) return null;
  if (store.tenantActiveSubscriber(tenantId, KYC_OUTBOUND_MIN)) return null;
  // Pfad 3 (outbound-p3): reiner fail-closed Deny. Wer Pfad 0-2 nicht passiert (kein
  // unrestricted-Profil, keine Profil-Nummer, kein aktiv-verifizierter Subscriber), wird
  // abgewiesen. Die statische ALLOWED_NUMBERS-Permit-/Break-Glass-Liste ist abgeschafft
  // (D8); die Notbremse ist jetzt OUTBOUND_FROZEN (ganz vorn in POST /api/calls).
  return {
    status: 403,
    grund: "allowlist",
    message: "Outbound nicht freigegeben: kein aktives Abo / keine Verifikation fuer diesen Tenant.",
  };
}

// KYC-Gate (P6b4): vor dem ersten Outbound muss der Tenant mindestens KYC_OUTBOUND_MIN
// (card) erreicht haben. fail-closed Schnittmenge - ergaenzt die Outbound-Gate-Kette,
// lockert NIE ein bestehendes Gate. Fehlendes kyc_level -> store.kycReached liefert seit Phase
// outbound-p1 FALSE (fail-closed 403); der Owner passiert, weil seedBootstrapKyc ihn beim Boot
// auf id_verified heilt. Liefert {status,grund,message} (Gate-Vertrag) oder null.
function kycGateError(tenantId) {
  if (store.kycReached(tenantId, KYC_OUTBOUND_MIN)) return null;
  return {
    status: 403,
    grund: "kyc",
    message: "Verifikation unzureichend (KYC) fuer Outbound-Anrufe. Bitte Identitaet bestaetigen.",
  };
}

// Liefert {status, grund, message} fuer das erste verletzte Gate, sonst null. caller =
// aufgeloeste Aufrufer-Identitaet { profile, requestedBy, tenantId } (F1: die drei reisen
// zusammen): profile/requestedBy steuern Land-Schnittmenge + pro-Nutzer-Limit, tenantId
// (Tenant-Achse) die Abo-Kopplung, den per-(Tenant,Ziel)-Cap UND den Defense-in-depth-Block
// im Allowlist-Gate.
function numberGateError(to, caller) {
  const { profile, requestedBy, tenantId } = caller;
  if (isDenied(to))
    return {
      status: 403,
      grund: "denylist",
      message: `Nummer ${to} ist gesperrt (Notruf-/Premium-/Service-Nummer). Anruf verweigert.`,
    };
  if (!E164.test(to))
    return { status: 400, grund: "format", message: "to muss E.164 sein, z.B. +4917212345678" };
  if (!countryGateAllowed(to, profile))
    return {
      status: 403,
      grund: "land",
      message: `Laendervorwahl von ${to} ist nicht erlaubt (ALLOWED_COUNTRY_CODES). Anruf verweigert.`,
    };
  if (globalHourReached())
    return {
      status: 429,
      grund: "stundenlimit",
      message: `Stundenlimit fuer Outbound-Anrufe erreicht (MAX_CALLS_PER_HOUR=${config.maxCallsPerHour}). Bitte spaeter erneut.`,
    };
  if (userHourReached(profile, requestedBy))
    return {
      status: 429,
      grund: "stundenlimit_nutzer",
      message: "Persoenliches Stundenlimit fuer Outbound-Anrufe erreicht. Bitte spaeter erneut.",
    };
  if (perTargetCapReached(tenantId, to))
    return {
      status: 429,
      grund: "ziel_limit",
      message: "Wiederhol-Limit fuer dieses Ziel erreicht. Bitte spaeter erneut.",
    };
  return allowlistError(to, caller);
}

// Direktiven fuer einen Sprach-Turn (Budget-Engine): Gather mit optionalem Prompt +
// Redirect-Fallback auf dieselbe Turn-URL. speechTimeoutSec (optional) setzt festes
// STT-Endpointing statt "auto" - NUR Folge-Gathers im /voice/turn (G3). Erst-Gather
// (Inbound-Greeting + Outbound) ruft OHNE -> "auto" bleibt (End-of-Speech-Erkennung
// noetig, sonst Erst-Turn-Deadlock). Telnyx-TeXML loest relative URLs anders auf als
// Twilio -> absolute URL fuer Telnyx (config.publicUrl im Module-Scope).
function turnDirectives(call, text, { speechTimeoutSec } = {}) {
  const isTelnyx = call.provider === "telnyx";
  const base = isTelnyx ? config.publicUrl : "";
  const action = `${base}/voice/turn?callId=${call.id}`;
  // Voice-Profil (TTS-Voice + STT-Locale) aus call.language ableiten (F1 P4). DE-Call
  // -> DE_FEMALE_NEURAL -> Renderer byte-identisch (Snapshot). Fail-safe ueber localeFor.
  const voiceProfile = localeFor(call.language).voiceProfile;
  return [gatherD({ promptText: text, action, voiceProfile, speechTimeoutSec }), redirectD(action)];
}

// Gesprochenen Satz im Voice-Profil des Calls rendern (F1 P4): sayD(text) defaultet auf
// DE; in den sprachabhaengigen Pfaden (Turn-Ende, Fehler) muss die Voice der call.language
// folgen. DE-Call -> DE-Default -> byte-identisch. EINE Ableitungsstelle (G5).
function sayInCallVoice(call, text) {
  return sayD(text, localeFor(call.language).voiceProfile);
}

// Folge-Gather im laufenden Gespraech (/voice/turn): wie turnDirectives, aber mit
// festem STT-Endpointing (config.sttSpeechTimeoutSec) gegen Satz-Truncation (G3).
// Eigener Name statt Boolean-Flag (kein Selektor-Argument, G15/F3).
function followupTurnDirectives(call, text) {
  return turnDirectives(call, text, { speechTimeoutSec: config.sttSpeechTimeoutSec });
}

// Gesprochene Degradations-/Reprompt-Texte fuer den /voice/turn-Fehlerpfad leben seit
// F1 P4 sprachabhaengig im Locale-Bundle (i18n/locales.js, eine Quelle pro Sprache):
//   llmDegradedSpeech  - wuerdevolles Ende bei anhaltender LLM-Nichtverfuegbarkeit
//                        (LlmUnavailableError aus dem resilienten Seam)
//   turnErrorSpeech    - generisches technisches Ende fuer jeden anderen Fehler
//   noSpeechReprompt   - knappe Rueckfrage, wenn der Gather leer lief (G4)
// Der Aufrufer hat call -> localeFor(call.language).<feld>. DE-Werte sind byte-identisch
// zum frueheren Inline-Bestand (i18n-Test pinnt sie).

// Realtime-Engine: Direktive fuer den Media-Stream an die Bridge. Der WS-Pfad ist
// provider-aware (Twilio /media byte-identisch, Telnyx eigener Pfad) - der upgrade-
// Handler leitet daraus fail-closed den Provider ab. stream_token authentifiziert
// den WebSocket (Bridge prueft beim start-Event, bridge.js).
function streamDirectives(call) {
  const path = MEDIA_PATH[call.provider] || MEDIA_PATH[DEFAULT_PROVIDER];
  const url = config.publicUrl.replace(/^https/, "wss") + path;
  return [
    streamD({
      url,
      params: [
        { name: "call_id", value: call.id },
        { name: "stream_token", value: call.streamToken },
      ],
    }),
  ];
}

// Tenant-Eigentums-Pruefung fuer Einzel-Call-Lesepfade (I5; I6/I7 reusen sie nach
// Rebase fuer cancel/Outbound). Die Scoping-Regel call.tenantId === tenantId lebt
// fuer Listen in state-ops tenantCallScope (via exportTenantData), hier fuer den
// Einzel-Call-Zugriff. Reines Praedikat, kein Nebeneffekt; der 404-Antwort-Code
// bleibt in der Route (Helper wiederverwendbar). Liefert true, wenn der
// Request-Tenant den Call besitzt.
const tenantOwnsCall = (call, tenant) => call.tenantId === tenant;

// Max-Dauer hart durchsetzen (Budget-Engine; Realtime macht das die Bridge).
// Provider-aware: beendet ueber denselben Provider, ueber den der Call laeuft
// (call.provider, P6a) - sonst wuerde ein Telnyx-Call ueber Twilio-endCall
// beendet (kein Effekt). Fuer Telnyx-Outbound ist dieser Timer der EINZIGE harte
// Max-Dauer-Cap (TimeLimit-Honorierung unbestaetigt) - Absolute Regel Max-Dauer.
function armMaxDurationTimer(call, providerCallSid) {
  const limit = (call.maxDurationS || config.maxCallDurationS) * 1000;
  setTimeout(() => {
    const c = store.getCall(call.id);
    if (c?.status === "active" && providerCallSid)
      voiceControl(c.provider)
        .endCall(providerCallSid)
        .catch(() => {});
  }, limit);
}

// ---------------- INBOUND ----------------
// Twilio-Nummer -> "A call comes in" -> POST {PUBLIC_URL}/voice/incoming
// Die Twilio-Signatur ist hier bereits fail-closed geprueft (app.use("/voice")).
// Erst danach wird To gelesen und auf einen Tenant aufgeloest (Anti-Spoof: To
// vor der Signatur waere Tenant-Spoofing). Unbekannte/fehlende To -> hoeflicher
// Hangup, KEIN Default-Tenant, KEIN aktiver Call (nicht-routbare Nummer kostet
// nichts).
app.post("/voice/incoming", (req, res) => {
  // Provider EINMAL aus dem (bereits fail-closed signatur-geprueften) Header
  // ableiten. Skip-Signature/lokale curl-Tests ohne Provider-Header -> Default
  // twilio -> byte-identisch zum Bestand. Quelle ist der Signatur-Header, nicht
  // To/provider (Anti-Spoof: liegt strukturell HINTER der Signatur).
  const provider = providerFromHeaders(req.headers) ?? DEFAULT_PROVIDER;
  const to = normNum(req.body.To);
  // EIN Lookup liefert tenantId UND number.language (F1 P4, §0-A: die angerufene Nummer
  // ist der Geo-Anker). null = unbekannte/nicht-aktive Nummer -> fail-closed Hangup.
  const numberRecord = store.numberRecordByE164(to);
  if (!numberRecord) {
    audit("inbound_unrouted", req, `to=${to || "-"}`);
    // Kein Tenant, kein Call -> keine Sprache ableitbar; der hoefliche Hangup bleibt DE
    // (byte-identisch zum Bestand, nicht ueber-engineeren).
    return res
      .type("text/xml")
      .send(
        render([sayD("Diese Nummer ist nicht erreichbar. Auf Wiederhoeren."), hangupD()], provider),
      );
  }
  const tenantId = numberRecord.tenantId;
  // Aufloesungs-Praezedenz (#8): settings.language -> number.language ->
  // tenant.defaultLanguage -> "de". Hier liegt der Geo-Anker der angerufenen Nummer vor.
  const language = store.resolveCallLanguage({ tenantId, numberRecord });
  const locale = localeFor(language);

  // Schnittmenge (R2): pro-Tenant-Budget UND globaler Plattform-Notaus muessen
  // frei sein. Fuer owner-only fallen beide zusammen -> byte-identisch zum Bestand.
  if (store.budgetExceeded(tenantId, config) || store.globalBudgetExceeded(config)) {
    return res
      .type("text/xml")
      .send(render([sayD(locale.budgetExhaustedHangup, locale.voiceProfile), hangupD()], provider));
  }

  const call = store.createCall({
    direction: "inbound",
    from: req.body.From || "unbekannt",
    to,
    twilioSid: req.body.CallSid,
    tenantId,
    provider,
    language,
  });
  store.markAnswered(call.id);
  armMaxDurationTimer(call, req.body.CallSid);

  if (config.voiceEngine === "realtime") {
    return res.type("text/xml").send(render(streamDirectives(call), provider));
  }

  const ctx = store.tenantContext(call.tenantId);
  const greeting = ctx.settings.greeting.replaceAll("{owner}", ctx.ownerName);
  store.addTranscript(call.id, "agent", greeting);
  res.type("text/xml").send(render(turnDirectives(call, greeting), provider));
});

// ---------------- GESPRAECHS-TURN (Budget-Engine, beide Richtungen) ----------------
app.post("/voice/turn", async (req, res) => {
  const call = store.getCall(req.query.callId);
  if (!call || call.status !== "active") {
    return res.type("text/xml").send(render([hangupD()]));
  }
  // L0: Luecke seit dem Render des vorigen Folge-Gathers ~ STT-Finalisierungs-Totzeit.
  metrics.logTurnGap(call.id);

  const heard = extractSpeech(req, call.provider);
  try {
    if (!heard && call.transcript.some((t) => t.role === "caller")) {
      metrics.recordTurnRendered(call.id); // L0: Folge-Gather offen -> Render-Zeitpunkt
      return res
        .type("text/xml")
        .send(
          render(
            followupTurnDirectives(call, localeFor(call.language).noSpeechReprompt),
            call.provider,
          ),
        );
    }
    const { speech, endCall } = await agentTurn(call, heard || null);
    const directives = endCall
      ? [sayInCallVoice(call, speech), hangupD()]
      : followupTurnDirectives(call, speech);
    if (!endCall) metrics.recordTurnRendered(call.id); // L0: nur wenn ein Folge-Turn folgt
    res.type("text/xml").send(render(directives, call.provider));
  } catch (err) {
    console.error("[turn]", err.message);
    // Schicht 2 (P3b-R): bei anhaltender LLM-Nichtverfuegbarkeit
    // (Breaker offen ODER Retries erschoepft -> LlmUnavailableError aus llm.complete)
    // wuerdevoll und kontrolliert beenden statt mit einem nackten "technischen Problem"
    // aufzulegen: der Agent verabschiedet sich hoeflich und sichert die Rueckmeldung zu.
    // KEIN Retry hier (der Seam hat bereits begrenzt+selektiv retried); das Gespraech
    // endet kontrolliert (Say + Hangup), kein stummer Abbruch. Jeder ANDERE Fehler
    // (nicht-transient, z.B. 4xx/Auth) bleibt terminal wie im Bestand.
    const locale = localeFor(call.language);
    const speech =
      err instanceof LlmUnavailableError ? locale.llmDegradedSpeech : locale.turnErrorSpeech;
    res.type("text/xml").send(render([sayInCallVoice(call, speech), hangupD()], call.provider));
  }
});

// ---------------- OUTBOUND: Angerufener nimmt ab ----------------
app.post("/voice/outbound", async (req, res) => {
  const call = store.getCall(req.query.callId);
  if (!call) {
    return res.type("text/xml").send(render([hangupD()]));
  }
  call.twilioSid = req.body.CallSid || call.twilioSid;
  store.markAnswered(call.id);
  store.save();

  if (config.voiceEngine === "realtime") {
    return res.type("text/xml").send(render(streamDirectives(call), call.provider));
  }

  // Schicht 1 (P3b-R) + G2: /voice/outbound ist LLM-FREI. Der gesamte gesprochene
  // Erst-Turn (Pflicht-Offenlegung Regel 2 als erster Satz + Bruecke + gekapptes
  // Anliegen) wird als EIN <Say> INNERHALB des <Gather> gerendert - byte-strukturgleich
  // zum bewaehrten Inbound-Greeting (turnDirectives(call, greeting)). Damit ist das
  // Mikrofon sofort offen und der Angerufene kann direkt antworten (loest den leeren-
  // Erst-Gather-Deadlock). openingText ist rein synchron -> der Webhook haengt NIE an
  // einem flackernden Upstream. Das Anliegen wird hier deterministisch genannt; der
  // erste LLM-Turn (/voice/turn) wiederholt es nicht (systemPrompt-Hinweis).
  const opening = openingText(call);
  store.addTranscript(call.id, "agent", opening);
  res.type("text/xml").send(render(turnDirectives(call, opening), call.provider));
});

const MS_PER_MINUTE = 60 * 1000;

// Abgerechnete Voice-Minuten EINES Calls (ceil ab answeredAt bis endedAt, Provider-
// Minutentakt). Nie beantwortet -> 0. EINE Minuten-Quelle (G5) fuer Stripe-Voice-Meter
// UND Budget-Reconcile.
function voiceMinutesOf(call) {
  if (!call.answeredAt || !call.endedAt) return 0;
  return Math.ceil((new Date(call.endedAt) - new Date(call.answeredAt)) / MS_PER_MINUTE);
}

// Voice-Minuten-Meter EINES beendeten Calls (P6b3, Meter 2). NUR im Metering-Pfad
// (PAYMENT_ENABLED, vom Aufrufer gegated) - Nebeneffekt (recordUsageEvent) im Namen.
// 0 Minuten -> kein Event (kein Null-Beleg). Kosten-Cents aus dem Ziel-Tarif
// (tariffCentsPerMin, EINE Kosten-Quelle G5) x Minuten.
function recordVoiceMinuteMeter(call) {
  const minutes = voiceMinutesOf(call);
  if (minutes <= 0) return;
  store.recordUsageEvent({
    tenantId: call.tenantId,
    callId: call.id,
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: minutes,
    costCents: minutes * tariffCentsPerMin(call.to),
  });
}

// Reconcile (outbound-p1c, Kosten-Achse, D1): bucht die IST-Voice-Minuten eines beendeten
// OUTBOUND-Calls (Minuten x Ziel-Tarif) in den Budget-Bucket des Tenants - so sieht der
// Budget-Gate + die Vorab-Reservierung endlich die Carrier-Minuten. IMMER (auch ohne
// PAYMENT_ENABLED, im owner-only-Interim). Inbound byte-identisch (kein Budget-Abzug).
// Nie beantwortet -> 0 Minuten -> kein Abzug. Nebeneffekt (Store-Mutation) im Namen (N7).
function reconcileOutboundVoiceBudget(call) {
  if (call.direction !== "outbound") return;
  const minutes = voiceMinutesOf(call);
  if (minutes <= 0) return;
  store.addVoiceUsageCostCents(call.tenantId, minutes * tariffCentsPerMin(call.to));
}

// number_month-Meter EINER neu aktivierten Nummer (P6b3, Meter 1). NUR im Metering-
// Pfad (PAYMENT_ENABLED, vom Aufrufer gegated) - der Nebeneffekt steht im Namen.
// number ist undefined, wenn der Job uebersprungen wurde (Re-Drain) -> kein Event.
// callId bewusst null (Nummern-Meter hat keinen Call). costCents = der per-Land-Setup-Tarif
// (P9): MUSS denselben Wert nutzen wie der Hold, sonst driftet das Ledger vom real
// gehaltenen/gecaptureten Betrag (Mini-R3 im usage_event). Land ohne eigenen Tarif / DE
// -> numberSetupFeeCents (byte-identisch).
function recordNumberMonthMeter(number) {
  if (!number) return;
  store.recordUsageEvent({
    tenantId: number.tenantId,
    kind: USAGE_EVENT_KIND.NUMBER_MONTH,
    quantity: 1,
    costCents: holdAmountForCountry(number.country, config.numberSetupFeeCents),
  });
}

// ---------------- Call zu Ende -> Summary + Notification + SMS ----------------
// Idempotent: kann von Status-Callback, Bridge und cancel_call gleichzeitig angestossen werden.
async function finishCall(call) {
  if (!call || call._finished) return;
  call._finished = true;
  // Voice-Minuten metern, BEVOR der Nicht-completed-Pfad early-returnt: auch ein
  // beantworteter, aber nicht zusammengefasster Call hat abrechenbare Minuten.
  if (config.paymentEnabled) recordVoiceMinuteMeter(call);
  reconcileOutboundVoiceBudget(call); // outbound-p1c: Carrier-Minuten in den Budget-Bucket (D1), IMMER
  store.save();

  if (call.status !== "completed" || !call.transcript.length) {
    store.addNotification(
      call.status === "cancelled" ? "Anruf abgebrochen" : "Anruf nicht zustande gekommen",
      `${call.direction === "outbound" ? call.to : call.from} (Status: ${call.status})`,
      call.id,
    );
    return;
  }

  try {
    const result = await summarizeCall(call);
    if (!result) return;
    // Roh-Transkript-Purge (#7, DSGVO-Datenminimierung): NUR nach Summary-Erfolg.
    // summarizeCall hat summary/objectiveAchieved + Action Items bereits persistiert;
    // das Roh-Transkript wird jetzt geloescht (nur noch Summary at rest). Scheitert
    // die Summary (result null / Exception), bleibt das Transkript -> die 30-Tage-
    // pruneOldData-Retention raeumt es als Defense-in-Depth ab.
    store.purgeTranscript(call.id);
    const aiCount = (result.actionItems || []).length;
    const who = call.direction === "outbound" ? `Anruf bei ${call.to}` : `Anruf von ${call.from}`;
    store.addNotification("Neue Call Summary", `${who}: ${result.summary}`, call.id);

    // F2 P7: Ziel + Sende-Entscheidung in planSummarySms ausgelagert (offline testbar -
    // server.js bootet beim Import). Ziel ist die PRIVATE Nummer des Call-Tenants (ueber
    // call.tenantId, identischer Schluessel wie der Absender -> keine Cross-Tenant-Fehl-
    // zustellung, H3), NICHT mehr config.ownerNumber (kein Fallback im finishCall-Pfad,
    // AK #5). Der Guard prueft Ziel + Absender + Opt-Out VOR jedem String-Bau, damit ein
    // fehlendes Ziel die .slice-Operation nie crasht (M4). settings.agentName fuer den
    // Body kommt aus derselben in-memory tenantContext-Quelle.
    const plan = planSummarySms(store, config, call);
    if (plan.send) {
      const sms =
        `[${store.tenantContext(call.tenantId).settings.agentName}] ${who}\n\n${result.summary}` +
        (aiCount
          ? `\n\nAction Items:\n` + result.actionItems.map((a, i) => `${i + 1}. ${a}`).join("\n")
          : "");
      try {
        await messaging(call.provider).sendSms({
          from: plan.smsFrom.e164,
          to: plan.to,
          body: sms.slice(0, 1500),
        });
        // F2 P8 (H1): Kosten-Beleg + Quelle des Tages-Cap-Zaehlers (dailySmsCount). NUR
        // nach ERFOLGREICHEM Send - schlaegt sendSms fehl, springt der catch an, es wird
        // KEIN Event geschrieben -> der Cap zaehlt nur real gesendete SMS (AK #3). grobe
        // Kosten aus dem benannten Tarif (config.smsCostCents); NIE die Zielnummer (PII).
        store.recordUsageEvent({
          tenantId: call.tenantId,
          callId: call.id,
          kind: USAGE_EVENT_KIND.SMS,
          quantity: 1,
          costCents: config.smsCostCents,
        });
        // F2 P9 (M2): persistierten Dedup-Marker setzen - NUR nach erfolgreichem Send.
        // Ueberlebt den Prozess-Restart und unterdrueckt eine zweite Summary-SMS bei einem
        // spaeten /voice/status-Retry (planSummarySms prueft summarySmsSentAt). Bewusst
        // NACH recordUsageEvent: der Marker steht erst, wenn die SMS real raus ist.
        store.markSummarySmsSent(call.id);
      } catch (e) {
        console.error(
          "[sms]",
          e.message,
          "(Trial: Zielnummer verifiziert? SMS-faehige Twilio-Nummer?)",
        );
      }
    } else if (plan.reason) {
      // Kein Ziel -> SMS still uebersprungen. Notification (oben) bleibt, kein Throw (M4).
      // Audit nur Marker + Reason, NIE die Nummer (H4); req=null -> ip=system.
      audit("sms_summary_skipped", null, `call=${call.id} reason=${plan.reason}`);
    }
  } catch (err) {
    console.error("[summary]", err.message);
  }
}

app.post("/voice/status", (req, res) => {
  res.sendStatus(200);
  const call = store.getCall(req.body.CallSid) || store.getCall(req.query.callId || "");
  if (!call) return; // Unbekannter Call: kein Status-Effekt UND kein Log (kein PII/Debug-Rauschen).
  const provider = call.provider || DEFAULT_PROVIDER;

  // TTS-Stoerung sichtbar machen (graceful degradation): Telnyx meldet ein
  // fehlgeschlagenes server-seitiges TTS (<Say> ueber Azure-NTTS) als Command-Event
  // OHNE CallStatus. Ein solches Event ist KEIN Lifecycle-Uebergang -> hier terminieren,
  // sonst wuerde es mit status=undefined faelschlich als Lifecycle-Event geloggt. Nur
  // der Fehlschlag wird geloggt (OK-Speak waere Rauschen) und macht die sporadische
  // Azure-Stoerung zum diagnostizierbaren, PII-freien Signal (reason = Telnyx-Token).
  const speak = extractSpeakOutcome(req, provider);
  if (speak.outcome !== SPEAK_OUTCOME.NONE) {
    if (speak.outcome === SPEAK_OUTCOME.FAILED)
      console.error(
        "[voice/speak]",
        JSON.stringify({ callId: call.id, provider, outcome: speak.outcome, reason: speak.reason }),
      );
    return;
  }

  const { status: callStatus, diagnostics } = extractLifecycleEvent(req, provider);
  // PII-frei (Pre-Mortem): nur callId/Status/Provider/Diagnose ins Log, NIE
  // From/To/Telefonnummern. Macht Telnyx-Lifecycle-Events + CallDuration + die
  // Hangup-Ursache (HangupCause/HangupSource/SipHangupCause) sichtbar - sonst ist
  // das Telnyx-Call-Ende beim Debugging blind.
  console.log(
    "[voice/status]",
    JSON.stringify({ callId: call.id, status: callStatus, provider, diagnostics }),
  );
  if (callStatus === "in-progress" || callStatus === "answered")
    return void store.markAnswered(call.id);
  if (!["completed", "busy", "no-answer", "failed", "canceled"].includes(callStatus)) return;
  if (call.status === "active")
    store.endCallRecord(call.id, callStatus === "completed" ? "completed" : "failed");
  finishCall(store.getCall(call.id));
});

// ================= REST-API (Dashboard + MCP-Tools) =================

// Absendernummer + Provider fuer den Outbound EINES Tenants (I7, L4). JEDER Tenant -
// auch der Owner (Tenant Null) - telefoniert NUR unter EIGENER aktiver Nummer (e164 +
// provider aus s.numbers); kein config-Sonderzweig mehr. Keine aktive eigene Nummer
// -> null -> Reject, NIE die Nummer eines anderen Tenants als Fallback (Toll-Fraud-
// Riegel, Pre-Mortem R3).
// numberRecord wird mitgegeben (nicht weggeworfen): der Geo-Anker der eigenen aktiven
// Nummer (F1 Phase 8) ist die Quelle der Outbound-Gespraechssprache (number.language)
// in der Praezedenz-Aufloesung. Kein neuer Absender-Pfad - nur ein zusaetzliches Feld.
function outboundFrom(s, tenantId) {
  const own = findActiveNumber(s, tenantId);
  return own ? { fromNumber: own.e164, provider: own.provider, numberRecord: own } : null;
}

// Outbound-Call starten (Vertrag laut Brief: objective/briefing/constraints/...)
app.post("/api/calls", async (req, res) => {
  const b = req.body || {};
  const to = normNum(b.to);
  const objective = b.objective || b.goal;
  if (!to || !objective) return res.status(400).json({ error: "to und objective sind Pflicht" });

  // OUTBOUND_FROZEN (outbound-p3): globaler Kill-Switch, ganz vorn + fail-closed. "true"
  // friert JEDEN Outbound sofort (403, kein Originate, kein Bypass) - Betriebs-Notbremse +
  // Sekunden-Rollback fuer den Allowlist-Cutover, ohne Deploy. Default false -> uebersprungen
  // (Normalbetrieb byte-identisch). VOR der Tenant-Aufloesung, damit auch unbekannte
  // Identitaeten erfasst sind. Audit ohne requestedBy (Identitaet hier bewusst noch nicht aufgeloest).
  if (config.outboundFrozen) {
    audit("place_call_denied", req, `to=${to} grund=frozen`);
    return res.status(403).json({ error: "Outbound-Anrufe sind derzeit gesperrt (OUTBOUND_FROZEN)." });
  }

  // Identitaet serverseitig (nur localhost-Header), nie aus dem Body. null = Owner.
  // Profile-Achse (Rechte: resolveProfile/requestedBy) UND Tenant-Achse (requestTenant)
  // PARALLEL aus derselben Identitaet (L4). Flag aus -> requestTenant === BOOTSTRAP_TENANT_ID
  // (byte-identisch).
  const identity = internalIdentity(req);
  const profile = store.resolveProfile(identity);
  const requestedBy = identity || OWNER_ID;
  const tenantId = requestTenant(req);

  // Tenant-Achse fail-closed: VORHANDENE, aber unbekannte Identitaet -> Reject, NIE
  // Owner (Asymmetrie zu resolveProfile). Ohne gueltigen Tenant darf gar kein
  // Outbound entstehen.
  if (tenantId === TENANT_REJECT) {
    audit("place_call_denied", req, `to=${to} grund=tenant_unbekannt requestedBy=${requestedBy}`);
    return res.status(403).json({ error: "Kein Tenant fuer diese Identitaet." });
  }

  // KYC-Gate (P6b4) als erstes Glied der Outbound-Gate-Kette: Tenant-Reifegrad VOR
  // den Ziel-Gates (Schnittmenge, fail-closed). Fehlendes kyc_level -> 403 (seit Phase
  // outbound-p1); der Owner ist beim Boot auf id_verified geheilt (seedBootstrapKyc) und
  // passiert. tenantId ist hier bereits aufgeloest + REJECT abgewiesen.
  const kycErr = kycGateError(tenantId);
  if (kycErr) {
    audit(
      "place_call_denied",
      req,
      `to=${to} grund=${kycErr.grund} tenant=${tenantId} requestedBy=${requestedBy}`,
    );
    return res.status(kycErr.status).json({ error: kycErr.message });
  }

  // Identitaets-Gate (G1, Geschwister-Regel zu Regel 2): ohne registrierten
  // Auftraggeber-Namen KEIN Outbound (sonst renderte die Offenlegung "...von .").
  // Fail-closed, NIE in /voice/outbound (Premature-close-Schutz) - hier am Producer.
  // tenantContext zieht ownerName aus dem Tenant (P2b: kein config-Fallback mehr, leerer
  // Default "") -> leer, solange der Tenant keinen ownerName im Store gesetzt hat. Genau
  // dann sperrt dieses Gate Outbound fail-closed (kein "...von ."-Leak in der Offenlegung).
  const ownerName = store.tenantContext(tenantId).ownerName;
  if (!ownerName) {
    audit(
      "place_call_denied",
      req,
      `to=${to} grund=keine_identitaet tenant=${tenantId} requestedBy=${requestedBy}`,
    );
    return res
      .status(403)
      .json({ error: "Kein registrierter Auftraggeber-Name fuer diesen Tenant." });
  }

  // Nummern-Gates VOR der Freitext-Validierung: gesperrte/ungueltige Ziele zuerst abweisen.
  const gateErr = numberGateError(to, { profile, requestedBy, tenantId });
  if (gateErr) {
    // 400 = Eingabe-/Formatfehler, keine Sicherheits-Ablehnung -> nicht auditieren.
    if (gateErr.status !== 400)
      audit("place_call_denied", req, `to=${to} grund=${gateErr.grund} requestedBy=${requestedBy}`);
    return res.status(gateErr.status).json({ error: gateErr.message });
  }

  const textErr =
    invalidText("objective", objective) ||
    invalidText("briefing", b.briefing) ||
    invalidText("constraints", b.constraints);
  if (textErr) return res.status(400).json({ error: textErr });

  // P3 (PLAN-PERSONAL-ASSISTANT): optionaler strukturierter Per-Call-Kontext, DIESELBE
  // Naht wie die objective/briefing-Validierung (NACH allen Gates). Hinter dem Flag
  // (Default aus -> b.context ignoriert, /api/calls byte-identisch). Validierung +
  // Normalisierung in EINER Quelle (_validation.js); Teilfeld/Array ueber Limit -> 400.
  // Der Kontext speist KEINE Identitaetsgroesse (Anti-Spoofing): er landet nur als
  // HINTERGRUND-Sektion im systemPrompt, nie in Offenlegung/Persona.
  let context = null;
  if (config.assistantContextEnabled) {
    const ctxResult = validateAssistantContext(b.context);
    if (ctxResult.error) return res.status(400).json({ error: ctxResult.error });
    context = ctxResult.value;
  }

  // Absendernummer + Provider tenant-aware (Toll-Fraud-Riegel R3): JEDER Tenant - auch
  // der Owner (Tenant Null) - telefoniert nur unter EIGENER aktiver Store-Nummer; keine
  // -> Reject, NIE die Nummer eines anderen Tenants als Fallback.
  const outbound = outboundFrom(store.load(), tenantId);
  if (!outbound) {
    audit(
      "place_call_denied",
      req,
      `to=${to} grund=keine_tenant_nummer tenant=${tenantId} requestedBy=${requestedBy}`,
    );
    return res.status(403).json({ error: "Kein aktive Absendernummer fuer diesen Tenant." });
  }
  const { fromNumber, provider: outboundProvider, numberRecord } = outbound;

  // Budget-Schnittmenge (R2): pro-Tenant-Budget (requestTenant) UND globaler Notaus
  // (Summe ueber alle Buckets) PARALLEL, beide fail-closed. Der globale Notaus wird
  // NIE entfernt; pro-Tenant schraenkt nur zusaetzlich ein. Owner-only byte-identisch.
  if (store.budgetExceeded(tenantId, config) || store.globalBudgetExceeded(config)) {
    audit("place_call_denied", req, `to=${to} grund=budget tenant=${tenantId}`);
    return res.status(402).json({ error: `Budget-Limit von ${config.maxBudgetEur} EUR erreicht.` });
  }

  const maxDur = Math.min(parseInt(b.max_duration_s || config.maxCallDurationS, 10) || 180, 300);
  // Vorab-Reservierung (Kosten-Achse, outbound-p1c, D1): Worst-Case-Minutenpreis (Ziel-Tarif
  // x maximal moegliche Minuten) gegen den verbleibenden effektiven Tenant-Cap. Reserve > Rest
  // -> 402 VOR dem Dial (kein Originate). Schnittmenge mit dem Budget-Gate oben; globaler
  // Notaus bleibt PARALLEL (Regel 1).
  const reserveCents = tariffCentsPerMin(to) * Math.ceil(maxDur / SECONDS_PER_MINUTE);
  if (store.reserveExceedsBudget(tenantId, reserveCents, config)) {
    audit("place_call_denied", req, `to=${to} grund=reserve tenant=${tenantId} requestedBy=${requestedBy}`);
    return res
      .status(402)
      .json({ error: "Voraussichtliche Anrufkosten ueberschreiten das verfuegbare Budget." });
  }
  // Outbound-Gespraechssprache (F1 Phase 8, Owner #8) aus DERSELBEN Praezedenz wie
  // Inbound: settings.language (Owner-Override) -> number.language (Geo-Anker der eigenen
  // aktiven Nummer) -> tenant.defaultLanguage -> "de". EINE Quelle (resolveCallLanguage),
  // damit ein API-/MCP-Aufrufer die kuratierte Sprachzuordnung NICHT per Call-Body
  // umgeht (b.language wird bewusst nicht mehr beruecksichtigt). DE byte-identisch:
  // Nummer ohne language + ohne settings.language -> "de" wie zuvor.
  const language = store.resolveCallLanguage({ tenantId, numberRecord });
  // Der /voice/outbound-Webhook rendert dank call.provider (P6a) automatisch TeXML
  // statt TwiML.
  const call = store.createCall({
    direction: "outbound",
    from: fromNumber,
    to,
    goal: objective,
    briefing: b.briefing,
    constraints: b.constraints,
    context,
    language,
    maxDurationS: maxDur,
    requestedBy,
    tenantId,
    provider: outboundProvider,
  });
  audit(
    "place_call",
    req,
    `to=${to} call=${call.id} provider=${outboundProvider} requestedBy=${requestedBy}`,
  );

  try {
    const tw = await voiceControl(outboundProvider).originateCall({
      from: fromNumber,
      to,
      url: `${config.publicUrl}/voice/outbound?callId=${call.id}`,
      statusCallback: `${config.publicUrl}/voice/status?callId=${call.id}`,
      statusCallbackEvent: ["answered", "completed"],
      method: "POST",
      timeLimit: maxDur,
    });
    call.twilioSid = tw.sid;
    store.save();
    // Max-Dauer hart durchsetzen (Budget-Engine). Fuer Twilio redundant zum
    // timeLimit-Param, fuer Telnyx der einzige verlaessliche Cap. Erst NACH
    // erfolgreichem Originate armen (vorher gibt es keinen providerCallSid).
    if (config.voiceEngine !== "realtime") armMaxDurationTimer(call, tw.sid);
    res.json({ ok: true, callId: call.id, twilioSid: tw.sid, status: "dialing" });
  } catch (err) {
    store.endCallRecord(call.id, "failed");
    // Rohe Provider-Message NICHT an den Client (Secret-/Param-Leak, Regel 4/5):
    // Provider-SDK-Fehler koennen URL-/Auth-/Nummern-Fragmente tragen. Serverseitig
    // secret-frei loggen (wie die P0-Guards: err.message, nie config), dem Aufrufer
    // eine generische, stabile Meldung geben.
    console.error(
      `[place_call] originate fehlgeschlagen call=${call.id}:`,
      err?.message || String(err),
    );
    // Der Adapter haengt bei einer Provider-HTTP-Ablehnung err.providerStatus an
    // (secret-frei). Liegt sie vor -> kategorisierte, provider-NEUTRALE Meldung mit
    // Statusklasse (502 Upstream), damit der Aufrufer den echten Grund erkennt statt
    // einer irrefuehrenden Twilio-Meldung bei einem Telnyx-Call. Der Twilio-Trial-Hint
    // nur bei Provider Twilio. Kein Roh-Body/Key an den Client (Regel 4/5).
    const providerStatus = err?.providerStatus;
    const body = providerStatus
      ? {
          error: `Provider hat den Anruf abgelehnt (HTTP ${providerStatus}). Account-/Nummern-Konfiguration pruefen.`,
        }
      : { error: "Anruf konnte nicht gestartet werden." };
    if (outboundProvider === "twilio") {
      body.hint = "Twilio-Trial: Die Zielnummer muss unter 'Verified Caller IDs' verifiziert sein.";
    }
    res.status(providerStatus ? 502 : 500).json(body);
  }
});

// Laufenden Anruf sauber abbrechen
app.post("/api/calls/:id/cancel", async (req, res) => {
  const call = store.getCall(req.params.id);
  // L5: fremder Tenant -> 404 (kein Existenz-Leck, NICHT 403). Hinter dem Flag:
  // aus -> ungefiltert wie heute (byte-identisch, auch fuer Calls ohne tenantId).
  // Nutzt I5's gemeinsamen tenantOwnsCall-Helper (eine Quelle der Ownership-Regel,
  // wie GET /api/calls/:id); !call short-circuitet vor dem tenantOwnsCall-Zugriff.
  if (!call || (config.multiTenant && !tenantOwnsCall(call, requestTenant(req))))
    return res.status(404).json({ error: "not found" });
  if (call.status !== "active") return res.json({ status: call.status });
  const requestedBy = internalIdentity(req) || OWNER_ID; // L5: forensisch nachvollziehbar
  audit("cancel_call", req, `call=${call.id} requestedBy=${requestedBy}`);
  store.endCallRecord(call.id, "cancelled");
  if (call.twilioSid) {
    try {
      // Provider-aware: ueber denselben Provider beenden, ueber den der Call
      // laeuft (call.provider) - sonst Twilio-endCall auf einem Telnyx-Call.
      await voiceControl(call.provider).endCall(call.twilioSid);
    } catch (e) {
      console.error("[cancel]", e.message);
    }
  }
  finishCall(store.getCall(call.id));
  res.json({ status: "cancelled" });
});

// ---- Read-/Export-Routen (Phase 3) ----
// T4-Decomposition: die GET-Route-Gruppe (/api/state, /api/calls/:id,
// /api/tenant-data/export) lebt jetzt in src/routes/api-read.js (makeReadRoutes,
// DI-Muster wie makeProfileRoutes) - reine Verschiebung, Verhalten unveraendert.
// STATE_*-Konstanten und die View-Helfer (publicCall/upcomingCalendar/activeNumberFor)
// sind mitgewandert; tenantOwnsCall (eine Quelle wie POST /api/calls/:id/cancel) und
// die request-tenant-Resolver werden injiziert. Hinter Basic-Auth (Bestand deckt
// /api/* ab); die lesenden MCP-Tools erben das Scoping AUTOMATISCH ueber /api/state.
app.use(
  makeReadRoutes({
    store,
    config,
    audit,
    tenant: { requestTenant, requireTenant, tenantOwnsCall },
  }),
);

app.post("/api/settings", (req, res) => {
  const tenant = requireTenant(req, res); // L2: tenant-gescopt; REJECT -> 403
  if (!tenant) return;
  const { settings, changed } = store.updateSettings(tenant, req.body || {});
  // Nur die Keys loggen - Werte (z.B. greeting-Freitext) gehoeren nicht ins Log
  audit("settings_update", req, `keys=${changed.join(",") || "-"}`);
  res.json(settings);
});

app.post("/api/action-items/:id/toggle", (req, res) => {
  const item = store.toggleActionItem(req.params.id);
  if (!item) return res.status(404).json({ error: "not found" });
  res.json(item);
});

app.post("/api/calendar", (req, res) => {
  const tenant = requireTenant(req, res); // tenant-gescopt; REJECT -> 403 (vor dem Booking-Recht)
  if (!tenant) return;
  // Booking-Recht (Phase 2): Owner/null erlaubt, restriktives Profil (allowBooking
  // false) wird abgewiesen. Identitaet nur vom localhost-Header, nie aus dem Body.
  const identity = internalIdentity(req);
  if (!store.resolveProfile(identity).allowBooking) {
    audit("booking_denied", req, `requestedBy=${identity || OWNER_ID}`);
    return res.status(403).json({ error: "Kein Recht, Termine zu buchen (allowBooking=false)." });
  }
  const { title, start, end } = req.body || {};
  if (!title || !start || !end)
    return res.status(400).json({ error: "title, start, end sind Pflicht" });
  const titleErr = invalidText("title", title);
  if (titleErr) return res.status(400).json({ error: titleErr });
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate) || isNaN(endDate))
    return res
      .status(400)
      .json({ error: "start und end muessen gueltige Datumswerte sein (ISO 8601)" });
  if (endDate <= startDate) return res.status(400).json({ error: "end muss nach start liegen" });
  // Normalisiert speichern: findConflict() vergleicht ISO-Strings lexikographisch
  res.json(store.addCalendarEvent(tenant, title, startDate.toISOString(), endDate.toISOString()));
});

// ---- Rechteprofile verwalten (Phase 2) ----
// AC7-Decomposition: die /api/profiles-Route-Gruppe lebt jetzt in
// src/routes/api-profiles.js (makeProfileRoutes, DI-Muster wie makeWebAuthRoutes) -
// reine Verschiebung, Verhalten unveraendert. validIdentity wird von dort importiert
// (eine Quelle, G5) und unten in /api/onboard weiterverwendet.
// Hinter Basic-Auth (Bestand deckt /api/* ab); KEIN MCP-Tool (s. Modul-Kommentar).
app.use(makeProfileRoutes({ store, audit }));

// ---- Stripe-Metering-Flush (P6b3): aggregiert den usage_event-Ledger je tenant+kind
// und meldet je Aggregat EIN reportMeter (idempotent ueber stripe_meter_sent). Hinter
// Basic-Auth (Bestand deckt /api/* ab; localhost = Owner) - KEIN MCP-Tool. NUR im
// Metering-Pfad erreichbar: ohne PAYMENT_ENABLED -> 404 (fail-closed, byte-identisch
// zum Bestand). "Periodisch" = extern cron-baar (echter Scheduler = P8); KEIN neuer
// Scheduler-Dep. Antwort = nur Zaehler {sent, failed} (KEINE Event-Inhalte, kein Secret).
app.post("/api/billing/flush-meters", async (req, res) => {
  if (!config.paymentEnabled)
    return res.status(404).json({ error: "metering disabled (PAYMENT_ENABLED)" });
  const result = await flushMeters(store.load(), { billing: stripeBilling });
  store.save();
  audit("meter_flush", req, `sent=${result.sent} failed=${result.failed}`);
  res.json(result);
});

// ---- Karten-Erfassung via Stripe Checkout (setup-Mode), Pay1 ----
// Hinter Basic-Auth (Bestand deckt /api/* ab; localhost = Owner). KEIN MCP-Tool
// (kein offener ungegateter Geld-Endpunkt, R4). tenant-scoped (requireTenant ->
// fail-closed 403 bei TENANT_REJECT). Ohne PAYMENT_ENABLED -> 404 (byte-identisch
// zum Bestand, Muster flush-meters). Die Karte wird OHNE Abbuchung am Customer
// gespeichert; der spaetere Hold/Capture (Pay2) nutzt customer+payment_method.
const CARD_ON_FILE_STATUS = "card_on_file"; // kein Magic-String (G25)

app.post("/api/billing/setup-checkout", async (req, res) => {
  if (!config.paymentEnabled)
    return res.status(404).json({ error: "payment disabled (PAYMENT_ENABLED)" });
  if (!config.publicUrl) return res.status(500).json({ error: "PUBLIC_URL fehlt" }); // kein Leak
  const tenant = requireTenant(req, res); // tenant-gescopt; REJECT -> 403
  if (!tenant) return;

  // Customer idempotent anlegen (geteilte Logik, G5: identisch zum Self-Service-Pfad).
  const customerId = await ensureCustomer({ store, billing: stripeBilling, tenant });
  const successUrl = `${config.publicUrl}/api/billing/checkout-return?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${config.publicUrl}/tenant.html?card=canceled`;
  const { url } = await stripeBilling.createSetupCheckoutSession({
    tenantRef: tenant,
    customerId,
    successUrl,
    cancelUrl,
  });
  audit("billing_setup_checkout", req, `tenant=${tenant}`);
  res.json({ url });
});

app.get("/api/billing/checkout-return", async (req, res) => {
  if (!config.paymentEnabled)
    return res.status(404).json({ error: "payment disabled (PAYMENT_ENABLED)" });
  const tenant = requireTenant(req, res); // tenant-gescopt; REJECT -> 403
  if (!tenant) return;
  const sessionId = req.query.session_id;
  if (!sessionId || typeof sessionId !== "string")
    return res.status(400).json({ error: "session_id ist Pflicht" });

  // Karte fail-closed an den eigenen Customer binden (geteilte Customer-Match-
  // Invariante, G5: identisch zum Self-Service-Pfad). Mismatch -> 403, kein Store.
  const { ok } = await bindCardFromSession({ store, billing: stripeBilling, tenant, sessionId });
  if (!ok) {
    audit("billing_card_mismatch", req, `tenant=${tenant}`);
    return res.status(403).json({ error: "Customer-Mismatch" });
  }
  audit("billing_card_saved", req, `tenant=${tenant}`);
  res.json({ status: CARD_ON_FILE_STATUS });
});

// ---- Onboarding (zahlungsfrei): Tenant registrieren -> Nummer anfragen ->
// (optional) echter Provider-Kauf -> aktivieren. Hinter Basic-Auth (Bestand deckt
// /api/* ab; localhost = Owner). BEWUSST KEIN MCP-Tool (kein Self-Service ueber MCP,
// kein offener ungegateter Geld-Endpunkt, R4). Die Kosten-Notbremse ist die
// Nummern-Cap (maxNumbers/maxNumbersPerTenant) - sie ERSETZT das uebersprungene
// Stripe-Schloss. Der echte Provider-Kauf laeuft NUR bei PROVISIONING_ENABLED=true;
// sonst Dry-Run (Nummer bleibt 'requested', KEIN Geld) - fail-closed Default.
const ONBOARD_REASON_STATUS = { tenant_inactive: 403, tenant_cap: 409, global_cap: 429 };

// Aktiver Geo-Lookup (F1 Phase 6, config-getrieben). Bei GEO_ENABLED aus = Null-Adapter
// (loest IP nie auf -> DE-Fallback, netzfrei). Einmal beim Routen-Setup gebaut.
const geoLookup = geoLookupAdapter();

app.post("/api/onboard", async (req, res) => {
  // G1: zwei Eingaben (firstName + lastName) statt eines ownerName (Owner-Entscheidung
  // #1). Beide optional + Freitext (duerfen Leerzeichen, NICHT durch validIdentity, das
  // nur den Routing-Schluessel tenantId prueft); registerTenant trimmt + komponiert
  // ownerName (Owner-Fallback bei leer).
  const { tenantId: bodyTenantId, firstName, lastName, privateNumber, idpSubject } = req.body || {};
  // P0: kanonische Identitaet. Ist idpSubject (WorkOS sub) gesetzt, ist DAS die Identitaet
  // -> kanonische tenantId deterministisch daraus (tenantIdForSubject, gleiche Quelle wie
  // der Web-Login) und der Record wird idp-gebunden (resolveTenant findet ihn -> MCP/REST
  // + Web-Login loesen denselben Tenant auf, Invarianten 1+2). Ohne idpSubject bleibt der
  // Owner-/Operator-Pfad byte-identisch (tenantId aus dem Body). Ein gesetztes, aber
  // ungueltiges idpSubject -> 400 (fail-closed, kein stiller Fallback auf den Owner-Pfad).
  if (idpSubject !== undefined && !validIdentity(idpSubject))
    return res
      .status(400)
      .json({ error: "idpSubject ungueltig (nicht leer, ohne Whitespace, <=254 Zeichen)" });
  const sub = idpSubject ?? null;
  const tenantId = sub ? tenantIdForSubject(sub) : bodyTenantId;
  if (!validIdentity(tenantId))
    return res
      .status(400)
      .json({ error: "tenantId ist Pflicht (nicht leer, ohne Whitespace, <=254 Zeichen)" });

  // F2: private Summary-Nummer ist OPTIONAL. VOR dem Store-Lock gegen DIESELBE Quelle
  // pruefen (normalizePrivateNumber, G5), damit ungueltige Eingaben als 400 statt 503
  // (Throw im Lock -> persist_error) zurueckkommen. Fehlt sie -> null, Onboarding wie
  // bisher. PII: nie ins Audit/Log (nur ein generischer Fehlertext, kein Wert, H4).
  try {
    normalizePrivateNumber(privateNumber);
  } catch {
    return res
      .status(400)
      .json({ error: "privateNumber ungueltig (E.164 erwartet, erlaubtes Land)" });
  }

  // F1 Phase 6 - Land/Sprache bei der Registrierung. Praezedenz (fail-safe):
  // User-Wahl (body.country, EXPLIZIT, autoritativ R4) > IP-Geo-VORSCHLAG (lokaler
  // Lookup, nur bei GEO_ENABLED) > config.provisioningCountry > DEFAULT_COUNTRY. Die IP
  // (req.ip, proxy-aware via 'trust proxy') verlaesst den Prozess NIE - der Lookup ist
  // streng lokal. Eine gespoofte IP aendert nichts Autoritatives: ohne User-Wahl ist sie
  // nur ein Vorschlag, mit User-Wahl wird sie ueberstimmt. language wird aus dem Land
  // abgeleitet (eine Quelle: languageForCountry). country (Herkunftsland) + language
  // landen auf Tenant-Geo; das Number-Request traegt das KAUF-Land (numberCountry, s.u.).
  // KEIN body.country + leeres forceNumberCountry -> Verhalten byte-identisch (DE/de).
  const proposedCountry = config.geoEnabled ? geoLookup(req.ip)?.country : null;
  const country = resolveOnboardCountry({
    userCountry: req.body?.country,
    proposedCountry,
    fallbackCountry: config.provisioningCountry,
  });
  const language = languageForCountry(country);
  // Kauf-Land (number.country) ENTKOPPELT vom Herkunftsland: config.forceNumberCountry
  // (z.B. "US") ueberschreibt NUR, wo die Nummer gekauft wird - die Sprache bleibt am
  // erkannten Herkunftsland (language oben). Leer -> Kauf-Land = Herkunftsland (byte-
  // identisch). tenant.country bleibt das Herkunftsland (Quelle fuer Sprache/Analytics).
  const numberCountry = config.forceNumberCountry || country;

  // Store-Mutation + Persistenz im prozess-lokalen kritischen Abschnitt (OT-3 AC2):
  // load -> registerTenant -> setTenantGeo -> requestNumber -> save, kein fremdes await
  // dazwischen. Ein Save-I/O-Fehler wird als behandelter 503 beantwortet (AC4), NIE als
  // unhandled async rejection (die den Request haengen liesse / den Prozess via P0-Netz killte).
  const reqRes = await store
    .withStoreLock(() => {
      const s = store.load();
      registerTenant(s, tenantId, {
        firstName,
        lastName,
        privateNumber,
        idpSubject: sub,
        defaultBudgetCents: config.defaultTenantBudgetCents,
      });
      setTenantGeo(s, tenantId, { country, defaultLanguage: language });
      const r = requestNumber(s, {
        tenantId,
        provider: PROVIDER.TELNYX,
        country: numberCountry,
        language,
        maxNumbers: config.maxNumbers,
        maxNumbersPerTenant: config.maxNumbersPerTenant,
      });
      if (r.ok) store.save(); // 'requested' persistieren (auch im Dry-Run)
      return r;
    })
    .catch((e) => {
      // mem/disk-Divergenz moeglich (In-Memory mutiert, Platte nicht) - sichtbar geloggt.
      console.error("[onboard] Persistenz fehlgeschlagen:", e.message);
      return { ok: false, reason: "persist_error" };
    });
  if (!reqRes.ok && reqRes.reason === "persist_error")
    return res.status(503).json({ error: "Persistenz fehlgeschlagen" });
  if (!reqRes.ok) {
    audit("onboard_denied", req, `tenant=${tenantId} grund=${reqRes.reason}`);
    return res
      .status(ONBOARD_REASON_STATUS[reqRes.reason] || 400)
      .json({ error: `Nummer-Anfrage abgelehnt (${reqRes.reason})` });
  }
  const numberId = reqRes.number.id;
  audit("onboard_request", req, `tenant=${tenantId} number=${numberId}`);

  // Dry-Run (Default, fail-closed): kein echter Kauf, Nummer bleibt 'requested'.
  if (!config.provisioningEnabled)
    return res.json({
      tenantId,
      numberId,
      status: reqRes.number.status,
      country,
      language,
      provisioning: "disabled",
    });

  // BEWUSSTE VERHALTENS-AENDERUNG (P6b2): das Provisioning ist aus dem HTTP-Request
  // geloest. Wir enqueuen einen Job, persistieren die Job-Spur ('requested' + queued)
  // und antworten SOFORT mit 'queued'; ein deterministischer Drain (In-Memory-Queue)
  // fuehrt provisionNumber asynchron aus. Die Geld-Sicherheits-Invarianten (Hold-vor-
  // Order, kein active ohne Capture, Rollback) bleiben in provisionNumber - jetzt im Worker.
  // Enqueue + Job-Spur teilen sich jetzt mit dem Webhook-Trigger (queueProvisioning, G5).
  const jobRes = await queueProvisioning(numberId, tenantId);
  if (!jobRes.ok) return res.status(503).json({ error: "Persistenz fehlgeschlagen" });
  audit("onboard_queued", req, `tenant=${tenantId} number=${numberId} job=${jobRes.jobId}`);
  res.json({
    tenantId,
    numberId,
    status: reqRes.number.status,
    country,
    language,
    provisioning: "queued",
    jobId: jobRes.jobId,
  });

  // Drain NACH der Response (fire-and-forget): kein echtes Hintergrund-Subsystem
  // (pg-boss ist deferred nach P8), aber HTTP endet vor dem Provider-Kauf. Tests
  // rufen den Drain deterministisch ueber die Queue-Instanz; hier wird er nur angestossen.
  void runProvisioningDrain();
});

// Provisioning-Job einreihen + Job-Spur persistieren (geteilt von /api/onboard UND dem
// Webhook-Aktivierungs-Trigger, G5). Enqueue ist idempotent ueber den number-id-Key;
// recordProvisioningJob dedupt die Spur. Liefert {ok, jobId} | {ok:false}. Der Aufrufer
// stoesst den Drain an (Reihenfolge bleibt aufrufer-spezifisch).
async function queueProvisioning(numberId, tenantId) {
  const idempotencyKey = `provision_${numberId}`;
  provisioningQueue.enqueue({ kind: PROVISION_NUMBER_JOB, payload: { numberId }, idempotencyKey });
  return store
    .withStoreLock(() => {
      const s = store.load();
      const job = recordProvisioningJob(s, { numberId, tenantId, idempotencyKey });
      store.save();
      return { ok: true, jobId: job.id };
    })
    .catch((e) => {
      console.error("[provision] Job-Spur fehlgeschlagen:", e.message);
      return { ok: false };
    });
}

// Webhook-Aktivierungs-Trigger (P3): nach bestaetigter Zahlung GENAU EINE Nummer pro
// Tenant anfragen und (bei PROVISIONING_ENABLED) den Kauf-Job einreihen. Idempotent
// (Invariante 4): hat der Tenant schon eine lebende Nummer -> No-op (Webhook-Retry/Folge-
// 'updated' kaufen nie doppelt). Land aus dem Tenant-Geo (onboard) mit config-Fallback;
// Sprache aus dem Land (eine Quelle, wie onboard). Geld-/Kauf-Invarianten (Hold-vor-Order,
// kein active ohne Capture, Rollback) bleiben in provisionNumber. Ein geblockter Kauf
// (Cap/persist_error) landet PII-frei (tenantId/Grund) im Audit-Trail (BK3); der Trigger
// hat keinen req-Kanal, daher req=null (audit markiert die Quelle als "system").
async function triggerTenantProvisioning(tenantId) {
  // Spiegel-Nachzug VOR der Provisionierung: activatePaidTenant aktiviert den Tenant nur in
  // der DB (accounts.setStatus) - der Store-Spiegel traegt noch den suspended-Login-Wert.
  // requestNumber liest den Spiegel-status; ohne Nachzug -> tenant_inactive -> kein Kauf
  // trotz bezahltem Abo (still uebersprungen). ensureTenant zieht den realen (jetzt active)
  // status nach. Laeuft VOR dem withStoreLock (eigener DB-Read via withClient, fail-safe,
  // kein Re-Entrancy-Konflikt mit dem Lock-Body).
  await store.ensureTenant(tenantId);
  const reqRes = await store
    .withStoreLock(() => {
      const s = store.load();
      // Decision-Core (Guard + requestNumber) liegt jetzt in provision-trigger.js -
      // EINE Quelle fuer Produktion und Test (G5). save bleibt hier (IO, P15).
      const r = requestNumberForPaidTenant(s, {
        tenantId,
        fallbackCountry: config.provisioningCountry,
        forceNumberCountry: config.forceNumberCountry,
        maxNumbers: config.maxNumbers,
        maxNumbersPerTenant: config.maxNumbersPerTenant,
      });
      if (r.ok) store.save();
      return r;
    })
    .catch((e) => {
      console.error("[webhook-provision] Persistenz fehlgeschlagen:", e.message);
      return { ok: false, reason: "persist_error" };
    });
  if (!reqRes.ok) {
    // already_provisioned ist ein erwarteter idempotenter No-op (Webhook-Retry/Folge-
    // event) - kein Audit-Wert. Jeder andere Grund (tenant_cap/global_cap = Kosten-
    // Notbremse, persist_error) ist forensisch relevant: kein Kauf trotz bezahltem Abo
    // -> in den Audit-Trail (Spec BK3: "Limit ueberschritten -> kein Kauf, Audit-Eintrag").
    // req=null -> audit-util markiert die Quelle als "system" (kein HTTP-Kontext im Webhook-
    // Trigger). Nur die tenantId + Grund-Code, kein Secret/PII (H4).
    if (reqRes.reason !== "already_provisioned")
      audit("webhook_provision_skipped", null, `tenant=${tenantId} grund=${reqRes.reason}`);
    return;
  }
  // Dry-Run (PROVISIONING_ENABLED=false, P3-Default): Nummer bleibt 'requested', KEIN Kauf.
  if (!config.provisioningEnabled) return;
  const jobRes = await queueProvisioning(reqRes.number.id, tenantId);
  if (jobRes.ok) void runProvisioningDrain();
}

// Verarbeitet wartende provision_number-Jobs deterministisch (In-Memory-Drain).
// Baut deps (provisioner + optional Stripe-Billing bei PAYMENT_ENABLED) genau wie
// der frueher synchrone Onboard-Pfad. KEIN active ohne Capture / Rollback liegen in
// provisionNumber. Persistiert nach jedem Job (Worker selbst ist save-frei, reine Fn).
async function runProvisioningDrain() {
  const s = store.load();
  const deps = { provisioner: numberProvisioning(PROVIDER.TELNYX) };
  // Geld-/Zahlungs-Optionen sind land-unabhaengig (global). Die Suchparameter
  // (countryCode/connectionId) werden PRO JOB aus dem Number-Record abgeleitet
  // (P7, Geo-Provisioning) - nicht mehr global aus config.provisioningCountry.
  const moneyOpts = {};
  if (config.paymentEnabled) {
    deps.billing = stripeBilling;
    moneyOpts.holdAmountCents = config.numberSetupFeeCents;
    moneyOpts.currency = config.paymentCurrency;
  }
  await provisioningQueue.drain(async (queuedJob) => {
    const record = s.provisioningJobs.find((j) => j.idempotencyKey === queuedJob.idempotencyKey);
    // Per-Job-Suchparameter aus dem Land des Number-Records (P7). Fehlender Record
    // (Re-Drain einer geloeschten Number) -> Worker skippt ueber den Zustandscheck;
    // searchParamsForCountry(undefined) liefert den globalen DE-Fallback (byte-identisch).
    const number = findNumber(s, queuedJob.payload.numberId);
    const geo = searchParamsForCountry(number?.country);
    // Per-Land-Hold (P9, R3): ueberschreibt den globalen moneyOpts.holdAmountCents nur,
    // wenn das Land einen eigenen Tarif hat; sonst = numberSetupFeeCents (byte-identisch).
    // Fehlender Record / DE -> Default. NUR im Geld-Pfad (PAYMENT_ENABLED), sonst undefined.
    const holdAmountCents = config.paymentEnabled
      ? holdAmountForCountry(number?.country, config.numberSetupFeeCents)
      : undefined;
    const opts = {
      ...moneyOpts,
      ...geo,
      ...(holdAmountCents !== undefined ? { holdAmountCents } : {}),
    };
    try {
      const r = await handleProvisionJob(s, queuedJob, deps, opts);
      if (record) markProvisioningJob(s, record.id, PROVISIONING_JOB_STATUS.DONE);
      // number_month-Meter (P6b3, Meter 1): NUR wenn eine Nummer NEU aktiviert wurde
      // (r.number, nicht skipped) UND im Metering-Pfad. Erste Periode bei Aktivierung
      // (monatlicher Scheduler = P8). costCents = der Setup-Tarif (numberSetupFeeCents).
      if (config.paymentEnabled) recordNumberMonthMeter(r.number);
      store.save();
      return r;
    } catch (err) {
      if (record) markProvisioningJob(s, record.id, PROVISIONING_JOB_STATUS.FAILED, err.message);
      store.save(); // 'failed'-Number + Job persistieren
      console.error("[provision-worker]", err.message);
      throw err; // drain markiert den Queue-Job failed; provisionNumber hat schon gerollbackt
    }
  });
}

// ================= MCP ueber Streamable HTTP (Custom Connector) =================
// Stateless: pro Request ein frischer Server+Transport (einfach & robust fuer den Prototyp).
// Auth via mcpAuth-Middleware (src/auth.js): Legacy-Bearer-Token, statisches
// Token oder OAuth 2.1 (MCP_AUTH). Fail-closed bleibt Default (nur localhost).
app.post("/mcp", mcpAuth, async (req, res) => {
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
  // Identitaet aus dem verifizierten JWT (req.auth). email bevorzugt, sonst sub
  // (Fail-closed: ein authentifizierter Nutzer OHNE email-Claim wird NICHT zum
  // Owner, sondern bekommt das restriktive DEFAULT_PROFILE). Selbst ohne email UND
  // sub bleibt es restriktiv (ANON_IDENTITY-Sentinel statt null/Owner). Kein
  // req.auth (Legacy/localhost/stdio) -> null -> Owner.
  const identity = req.auth ? req.auth.email || req.auth.sub || ANON_IDENTITY : null;
  const profile = store.resolveProfile(identity);
  try {
    // Rich-UI: Server deklariert die io.modelcontextprotocol/ui-Extension im initialize-
    // Response (MCP Apps / SEP-1865 - PFLICHT, sonst rendert der Host das ui://-Widget
    // NICHT, auch bei korrektem Tool-_meta). Nur bei aktivem Master-Schalter; aus ->
    // keine Extension -> byte-identisch. Auto-registrierte tools/resources werden vom SDK
    // dazugemerged (verdraengen die Extension nicht).
    const serverOptions = config.mcpUiEnabled
      ? { capabilities: { extensions: uiServerExtension() } }
      : undefined;
    const server = new McpServer({ name: "hermes", version: "0.2.0" }, serverOptions);
    // Rich-UI-Host-Hinweis: gegated NUR durch den Master-Schalter config.mcpUiEnabled
    // (aus -> uiHost.enabled=false -> Stufe-0-only, byte-identisch). Der MCP-native
    // Renderer ist der Default (siehe ui/registry.js); kein per-Request-Capability-Gate
    // mehr, weil der stateless Transport (sessionIdGenerator=undefined) die initialize-
    // Capabilities nicht zum tools/list-POST mitfuehrt - das Widget-_meta erschien sonst
    // NIE. capabilities dienen nur noch der expliziten ChatGPT-Adapter-Wahl. Kein neuer
    // Endpunkt, mcpAuth + res.on("close")-Cleanup unveraendert.
    const uiHost = { enabled: config.mcpUiEnabled, capabilities: req.body?.params?.capabilities };
    registerTools(server, { identity, scopedTenant, allowCalendar: profile.allowCalendar, uiHost });
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
app.get("/mcp", (_req, res) => res.status(405).json({ error: "POST only (stateless transport)" }));
app.delete("/mcp", (_req, res) =>
  res.status(405).json({ error: "POST only (stateless transport)" }),
);

// ---- Catch-all Error-Net (AC4) -------------------------------------------------
// MUSS NACH allen Route-Mounts und VOR app.listen stehen: Express-Error-MW sieht nur
// Fehler von davor gemounteten Routen. Last-Resort-Netz fuer synchron geworfene/per
// next(err) gereichte Routen-Fehler -> generische 500, NIE err.message/stack/Env an den
// Client (Regel 4/5); err.stack nur server-seitig laut geloggt. Die per-Route-try/catch
// (z.B. /auth/login, /voice/turn) bleiben die primaere Schicht (Express 4 reicht
// async-Rejections NICHT automatisch hierher). Die body-parser-Error-MW (oben, 4xx
// Parser-Fehler) bleibt unveraendert an ihrer Stelle.
app.use(errorHandler);

// ---------------- Start ----------------
store.load();

// Retention (DSGVO): alte Transkripte/Notifications beim Start und periodisch loeschen
const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
function runRetention() {
  const removed = store.pruneOldData();
  if (removed.calls || removed.notifications || removed.actionItems)
    console.log(
      `[retention] geloescht: ${removed.calls} Calls, ${removed.notifications} Notifications, ${removed.actionItems} erledigte Action Items (aelter als ${config.retentionDays} Tage)`,
    );
}
runRetention();
setInterval(runRetention, RETENTION_SWEEP_INTERVAL_MS).unref();

const ok = assertConfig();
// Fail-closed (OT-4): bei ungueltiger Safety-/Pflicht-Konfiguration wird der Dienst
// GAR NICHT gestartet - kein app.listen, kein /voice, kein /mcp, keine Audio-Bridge.
// Lieber kein Dienst als ein Dienst mit lautlos abgeschaltetem Budget-/Kosten-Gate
// (R4 Toll-Fraud). Die actionable Diagnose hat assertConfig() bereits ausgegeben.
if (!ok) {
  console.error("[boot] Start abgebrochen: Safety-/Pflicht-Konfiguration ungueltig (siehe oben).");
  process.exit(1);
}

// Boot-Guard (Pre-Mortem): jeder Tenant - auch der Bootstrap-Tenant - haelt seine
// Absendernummer im Store, nicht in der Env. Tenant-agnostisch (P2b): der Dienst ist
// "telefonbar", sobald IRGENDEIN Tenant eine aktive Nummer hat (kein OWNER/BOOTSTRAP-Pin
// mehr). Nach lokalem Reset (data/store.json geloescht) oder frischem Postgres ohne Seed
// waere keine aktive Nummer da -> Outbound + SMS still tot. Fail-closed wie die fruehere
// TWILIO_NUMBER-Boot-Pflicht: leerer Store -> kein Start. Loggt KEINE Nummer (kein Leak),
// verweist auf das Bootstrap-CLI.
if (!hasActiveNumber(store.load())) {
  console.error(
    "[boot] Keine aktive Nummer im Store. Erst seeden: " +
      "npm run bootstrap-tenant -- <e164> <provider>",
  );
  process.exit(1);
}

const httpServer = app.listen(config.port, () => {
  // Tatsaechlichen Port verwenden: bei PORT=0 (Tests) vergibt das OS einen freien Port
  const port = httpServer.address().port;
  // Eigene REST-API fuer die MCP-Tools erreichbar machen (auch bei abweichendem PORT)
  process.env.GATEWAY_URL ||= `http://localhost:${port}`;
  // TEMP-DIAGNOSE (STT-Live-Abschluss, siehe STATUS.md Abschnitt 2): deployten Commit ausgeben, damit im
  // Render-Log eindeutig sichtbar ist, WELCHE Version laeuft (Render setzt
  // RENDER_GIT_COMMIT). Phase 3: wieder entfernen.
  console.log(`  [boot] deployed commit=${process.env.RENDER_GIT_COMMIT || "unbekannt"}`);
  console.log(`\n  Hermes Gateway laeuft auf http://localhost:${port}`);
  console.log(`  Dashboard:      http://localhost:${port}`);
  console.log(
    `  Voice-Engine:   ${config.voiceEngine}${config.voiceEngine === "realtime" && !config.openaiApiKey ? "  (ACHTUNG: OPENAI_API_KEY fehlt!)" : ""}`,
  );
  console.log(
    `  MCP (HTTP):     ${config.publicUrl || "PUBLIC_URL fehlt!"}/mcp  <- als Custom Connector in Claude eintragen`,
  );
  console.log(`  Twilio-Webhook: ${config.publicUrl || "PUBLIC_URL fehlt!"}/voice/incoming`);
  console.log(`  Status-Callback:${config.publicUrl || "PUBLIC_URL fehlt!"}/voice/status`);
  // Outbound-Freigabe (outbound-p3): keine statische ALLOWED_NUMBERS-Liste mehr - Permit ist
  // die per-Tenant-Verifikation (Abo+KYC, Pfad 2). OUTBOUND_FROZEN zeigt den globalen
  // Kill-Switch-Zustand. Kein PII (Nummern) mehr im Banner.
  console.log(
    `  Outbound:       ${config.outboundFrozen ? "EINGEFROREN (OUTBOUND_FROZEN=true)" : "aktiv (Verifikation per Tenant: Abo+KYC)"}`,
  );
  console.log(
    `  Nummern-Gates:  Land ${config.allowedCountryCodes.join(",")} | max ${config.maxCallsPerHour} Calls/h | Notruf-/Premium-Denylist aktiv`,
  );
});

// Audio-Bridge (nur relevant bei VOICE_ENGINE=realtime)
attachMediaBridge(httpServer, finishCall);

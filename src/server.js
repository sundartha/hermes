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
  DEFAULT_PROVIDER,
  PROVIDER,
  NUMBER_STATUS,
  USAGE_EVENT_KIND,
  KYC_OUTBOUND_MIN,
  tenantIdForSubject,
  normNum,
  shouldPersistProvisionResult,
} from "./store/defaults.js";
import { hasActiveNumber } from "./store/views.js";
import { planSummarySms } from "./sms-summary.js";
import {
  agentTurn,
  summarizeCall,
  openingText,
  callerHasSpoken,
} from "./claude.js";
import { makeTelnyxLlmShim } from "./telnyx-llm-shim.js";
import { makeCallControlIngest } from "./telnyx-call-control-ingest.js";
import { makeConversationWatchdog, WATCHDOG_LOG_PREFIX } from "./telnyx-conversation-watchdog.js";
import { makeCallControlTerminator } from "./telnyx-call-terminate.js";
import { originateAiAssistantCall } from "./telnyx-origination.js";
import { startInboundAiAssistant, inboundCallControlId } from "./telnyx-inbound.js";
import { metrics } from "./metrics.js";
import { degradedSpeechFor } from "./llm.js";
import { registerTools } from "./mcp-tools.js";
import { uiServerExtension } from "./ui/contract.js";
import { HERMES_SERVER_INFO, BRAND_ASSETS_PREFIX } from "./mcp-server-info.js";
import { attachMediaBridge } from "./bridge.js";
import { createTtsStore } from "./tts/store.js";
import { makeDirectiveSynth } from "./tts/directive-synth.js";
import { createRateLimiter, securityHeaders, errorHandler } from "./middleware.js";
import { mcpAuth, registerWellKnown } from "./auth.js";
import { audit, safeEqual, hashEmail } from "./util.js";
import {
  voiceControl,
  messaging,
  webhookEvents,
  inboundSignatureVerifier,
  providerFromHeaders,
  numberProvisioning,
} from "./telephony/registry.js";
import {
  say as sayD,
  hangup as hangupD,
} from "./telephony/directives.js";
import { makeVoiceRender } from "./telephony/voice-render.js";
import { localeFor, languageForCountry } from "./i18n/locales.js";
import { SPEAK_OUTCOME } from "./telephony/adapters/telnyx/speak-events.js";
import { callFailureReason } from "./telephony/failure-reason.js";
import { terminateAndBillCall, hangUpAction, billThunk } from "./telephony/call-termination.js";
import { makeCallFinish } from "./telephony/call-finish.js";
import {
  makeOutboundGates,
  E164_FORMAT_ERROR,
  isTrunkZeroFormatError,
} from "./telephony/outbound-gates.js";
import { reattachActiveCall as reattachActiveCallCore } from "./telephony/reattach.js";
import { makeCallLifecycle } from "./telephony/call-lifecycle.js";
import {
  registerTenant,
  setTenantIdentityIfAbsent,
  normalizePrivateNumber,
  requestNumber,
  recordProvisioningJob,
  markProvisioningJob,
  classifyQueuedProvisioningJobs,
  setTenantGeo,
  findNumber,
  classifyCallTime,
  cappedEndedAtMs,
} from "./store/state-ops.js";
import { geoLookupAdapter } from "./geo/registry.js";
import { resolveOnboardCountry } from "./geo/resolve.js";
import { checkSubAlreadyMerged } from "./onboard-guard.js";
import { handleProvisionJob } from "./worker/provisioning.js";
import { makeProvisioningOrchestrator } from "./worker/provisioning-orchestrator.js";
import { resolveProvisionRetry } from "./billing/provision-trigger.js";
import { createQueue } from "./queue/registry.js";
import { stripeBilling } from "./billing/stripe.js";
import { makeMetering } from "./billing/metering.js";
import { verifyStripeSignature, applyStripeWebhookSerialized } from "./billing/webhook.js";
import { makeReadRoutes } from "./routes/api-read.js";
import { makeTenantWriteRoutes } from "./routes/api-tenant-write.js";
import { makeSelfServiceRoutes } from "./self-service-routes.js";
import { makeProfileRoutes, validIdentity } from "./routes/api-profiles.js";
import { makeBillingRoutes } from "./routes/api-billing.js";
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
  LOGIN_ROUTE,
} from "./web-auth.js";
import { makePortalStore } from "./store/portal.js";
import { makeAuditStore } from "./audit-store.js";
import { runReleaseReconcile } from "./release-reconcile.js";
import { createPortalRunner } from "./portal-pool.js";
import { guardedBoot, fakeOriginateBootBlocked } from "./boot-guard.js";
import {
  makeRequestTenant,
  isTrustedLocalCaller,
  internalIdentity,
  OWNER_ID,
  ANON_IDENTITY,
  TENANT_REJECT,
  tenantOwnsCall,
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

// Outbound-Gate-Kette EINMAL beim Boot verdrahtet (Modul-Scope wie provisioningQueue,
// P15): geordnetes Array, Reihenfolge per test/outbound-gates-order.test.js festgenagelt.
// requestTenant/internalIdentity/OWNER_ID/TENANT_REJECT werden durchgereicht (EINE Quelle,
// kein zweiter Tenant-Resolver, G5/DIP).
const { gates: outboundGates } = makeOutboundGates({
  store,
  config,
  requestTenant,
  internalIdentity,
  OWNER_ID,
  TENANT_REJECT,
});

// Metering-Instanz (P6b3-Meter + outbound-p1c-Reconcile) EINMAL beim Boot verdrahtet
// (Naht wie outboundGates/provisioningQueue, nicht im Handler; INV-7). store+config
// werden geschlossen; die Gating-Bedingung `if (config.paymentEnabled)` bleibt beim
// Aufrufer (finishCall / Provisioning-Drain), nicht im Modul.
const metering = makeMetering({ store, config });

// call-finish (P4): finishCall (Settlement/Summary/SMS) + releaseReserve (Reserve-Freigabe)
// EINMAL beim Boot verdrahtet (Naht wie metering/outboundGates, nicht im Handler; INV-7).
// EINE Instanz: dieselbe finishCall-Referenz geht an attachMediaBridge UND makeCallControlIngest
// (call._finished/billedAt-Guards verlangen Identitaet). metering ist oben konstruiert (P1);
// die paymentEnabled-Gating-Bedingung bleibt im finishCall-Body (INV-9), Cents bleiben Ganzzahl.
const callFinish = makeCallFinish({
  store,
  config,
  metering,
  messaging,
  summarizeCall,
  planSummarySms,
  audit,
});

// call-lifecycle (P5): Cap-Timer (Max-Dauer), Reserve-Release-Backstop, Re-Attach-Wrapper
// und Boot-Re-Arm. EINMAL beim Boot verdrahtet (Naht wie metering/callFinish, INV-7),
// konstruiert NACH callFinish (linearer DAG): finishCall/releaseReserve kommen fertig
// gebunden herein (kein Lazy-Thunk, P15). INV-9: terminateCappedCall bleibt der EINZIGE
// Terminalisierungspfad (Provider-Leg zuerst, dann buchen - via terminateAndBillCall).
const lifecycle = makeCallLifecycle({
  store,
  config,
  finishCall: callFinish.finishCall,
  releaseReserve: callFinish.releaseReserve,
  voiceControl,
  terminateAndBillCall,
  hangUpAction,
  billThunk,
  reattachActiveCallCore,
  cappedEndedAtMs,
  classifyCallTime,
});

// provisioning-orchestrator (P6): enqueue/trigger/drain(single-flight)/reconcile fuer den
// Nummern-Kauf. EINMAL beim Boot verdrahtet (Naht wie metering/callFinish/lifecycle, INV-7):
// der Single-Flight-Guard lebt im Factory-Scope = EIN Drain-Guard pro Prozess (kein
// Doppelkauf). KONSTRUIERT VOR dem guardedBoot-Block (unten), weil triggerTenantProvisioning
// dort als provision-Seam an zwei Stellen (self-service + Stripe-Webhook) gebraucht wird -
// eine spaetere Konstruktion feuerte im pg+session-Boot einen TDZ-ReferenceError, den
// guardedBoot fail-OPEN verschluckt (Routen lautlos 404, INV-11). provisioningQueue + metering
// (P1) liegen bereits davor.
const provisioning = makeProvisioningOrchestrator({
  store,
  config,
  queue: provisioningQueue,
  billing: stripeBilling,
  metering,
  numberProvisioning,
  handleProvisionJob,
  resolveProvisionRetry,
  audit,
  recordProvisioningJob,
  markProvisioningJob,
  classifyQueuedProvisioningJobs,
  findNumber,
});

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

// ---- Telnyx AI Assistant Brain-Shim (PLAN-TELNYX-AI-ASSISTANT.md, P1) ----------------
// AUTH-AUSNAHME (Regel 3, begruendet): Telnyx BYO-LLM ruft diesen /v1/chat/completions-
// kompatiblen Endpunkt SERVERSEITIG (kein Basic-Auth-Header moeglich) -> bewusst VOR der
// Basic-Auth registriert (analog /voice/tts/:token), mit EIGENER fail-closed Absicherung:
// 404 bei TELNYX_AI_ASSISTANT_ENABLED aus (Existenz hinter dem Flag); statisches Bearer-
// Integration-Secret (E2) timing-sicher via safeEqual + call_control_id-Korrelation aus
// forward_metadata (E1) gegen den Store-Call-Record (403 sonst); Budget-Gate pro Turn (kein
// Token-Burn ueber dem Cap). NICHT unter /voice -> die Ed25519-Signaturpruefung (P4.5)
// bleibt unberuehrt. Das Registrieren deaktiviert KEINE bestehende Middleware (Express
// fuehrt sie fuer andere Pfade unveraendert weiter aus, Invariante 4).
// stab-p9 (Kosten-Notaus): EIN ConversationWatchdog, geteilt von Shim (Loop-Guard +
// Dead-Air-Feed pro Turn) und Call-Control-Ingest (Dead-Air armieren bei ai_assistant_start,
// stoppen bei hangup). Terminierung ueber das GETEILTE Call-Control-Hangup-Primitiv (auch
// der Shim nutzt makeCallControlTerminator fuer Budget-Kill/end_call, S2).
const conversationWatchdog = makeConversationWatchdog({
  config,
  terminate: makeCallControlTerminator({ store, voiceControl, logPrefix: WATCHDOG_LOG_PREFIX }),
});
app.post("/v1/chat/completions", makeTelnyxLlmShim({ store, config, agentTurn, localeFor, voiceControl, watchdog: conversationWatchdog }));

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

// tenant-prolif-d: Sweep-Kadenz des DID-Release-Reconcilers. Wie RETENTION_SWEEP_INTERVAL_MS
// eine interne Kadenz (kein Operator-Knopf) -> Modul-Konstante, nicht config.js; der
// eigentliche Sicherheits-Knopf ist das Grace-Fenster (RELEASE_GRACE_DAYS, config).
const RELEASE_RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Boot-Lauf + periodischer Sweep des DID-Release-Reconcilers. fire-and-forget (blockiert
// weder guardedBoot/listen noch den Healthcheck); nowMs pro Lauf injiziert -> der reine
// Klassifizierer/Executor bleibt Date.now-frei. Wird aus dem guardedBoot-Block gerufen,
// weil der durable Audit (auditStore) den privilegierten portalRunner braucht - denselben
// Runner wie der suspended_at-stempelnde Billing-Webhook (EINE pg-Wiring-Quelle, G5).
// Free-Tier-Vorbehalt: Render-Free kann schlafen -> der Boot-Lauf deckt den Deploy-Fall;
// eine Render-Cron ist das spaetere Upgrade (fuer den Launch nicht noetig, Observe-Only-Default).
function scheduleReleaseReconcile(deps) {
  const run = () =>
    void runReleaseReconcile({ ...deps, nowMs: Date.now() }).catch((e) =>
      console.error("[did-release]", e.message),
    );
  run();
  setInterval(run, RELEASE_RECONCILE_INTERVAL_MS).unref();
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
    // tenant-prolif-d: DID-Release-Reconcile scharfschalten (Boot-Lauf + Sweep). Der
    // Provider laeuft ueber den bestehenden NumberProvisioning-Port (nur Telnyx). graceMs=0
    // (Default) = Observe-Only -> loggt nur Kandidaten, gibt nichts frei.
    scheduleReleaseReconcile({
      store,
      provisioner: numberProvisioning(PROVIDER.TELNYX),
      audit: auditStore,
      graceMs: config.releaseGraceMs,
    });
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
        // WorkOS-Sign-out-Rueckkehr-URL (return_to), symmetrisch zu redirectUri oben.
        // Muss im WorkOS-Dashboard als Sign-out-Redirect-URL registriert sein (Phase 3).
        postLogoutUrl: config.publicUrl + LOGIN_ROUTE,
        // Lokaler Dev-Login-Shim (NUR mit config.devLoginEnabled, fail-closed): mintet
        // dieselbe Session wie der echte Callback fuer den Chrome-e2e-Loop ohne WorkOS.
        devLoginEnabled: config.devLoginEnabled,
        // Signup-Spiegel-Nachzug: zieht den per accounts.upsertOnFirstLogin (mintSession)
        // frisch angelegten Tenant in den pg-Store-Spiegel, BEVOR der Self-Service-Subscribe-
        // Pfad eine WRITE-Store-Op (setTenantStripe etc.) ausloest, die ihn sonst nicht faende.
        ensureTenant: (tid) => store.ensureTenant(tid),
        // tenant-prolif-b: nach dem Login den (evtl. gemergten) sub in den Resolver-Index
        // spiegeln (mintSession), damit der MCP/REST-Kanal den kanonischen Tenant ohne Neustart
        // aufloest. Fassade store.bindSubToTenant (beide Backends).
        bindSub: (sub, tid) => store.bindSubToTenant(sub, tid),
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
    // des Tenants; jede Aktion auditiert; nicht-existenter Tenant -> 404. store: approve
    // loescht den suspended_at-Grace-Anker (tenant-prolif-c Invariante 2, G3-Fix).
    app.use(makeAdminRoutes({ accounts, sessions, audit: auditStore, webAuthMw, adminMw, store }));

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
          provision: provisioning.triggerTenantProvisioning,
        }),
      );
    }

    // ---- Stripe-Webhook (W4): Abo-Lifecycle nachziehen ------------------------------
    // KEINE Basic-Auth (Stripe kann keine Credentials senden) - die Sicherung ist die
    // HMAC-Signaturpruefung gegen STRIPE_WEBHOOK_SECRET (fail-closed, eigener Begruendungs-
    // Kommentar wie /voice, Regel 3). Ohne PAYMENT_ENABLED -> 404 (byte-identisch).
    // Liegt im guardedBoot-Block, weil applyStripeWebhookSerialized (P1) accounts.setStatus +
    // sessions.invalidateByTenant braucht (nur hier konstruiert). Serialisiert pro Stripe-
    // Korrelationsschluessel (subscriptionId, Fallback tenantRef) + verwirft veraltete/doppelte
    // Events (Ordnungswache) - Details in billing/webhook.js. Idempotent: jeder Event wirkt nur
    // als Vorwaerts-Zustand; Wiederholung aendert nichts.
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
      await applyStripeWebhookSerialized(event, {
        store,
        accounts,
        sessions,
        audit,
        req,
        provision: provisioning.triggerTenantProvisioning,
        billing: stripeBilling,
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
  app.get("/app/*", (_req, res) => res.sendFile(path.join(config.webDistDir, "app", "index.html")));
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
    req.path === "/healthz" ||
    // T3: das Server-Icon (public/brand/*, Quelle src/mcp-server-info.js) ist keine
    // sensible Nutzdaten-Route, nur ein statisches PNG. Ein MCP-Host laedt
    // icons[0].src aus der initialize-Antwort OHNE Dashboard-Credentials - ohne diese
    // Ausnahme liefert die express.static-Route weiter unten in Produktion
    // (DASHBOARD_PASSWORD gesetzt) 401 statt des Icons, der T3-Fix waere live
    // wirkungslos (empirisch geprueft, exakt wie die STRIPE_WEBHOOK_PATH-Begruendung
    // oben: eng auf ein Praefix begrenzt, kein Blanket-Bypass).
    req.path.startsWith(BRAND_ASSETS_PREFIX) ||
    // Favicon-Konvention: Icon-Fetcher (Browser-Tabs, Connector-UIs wie
    // claude.ai) ziehen /favicon.ico OHNE Credentials von der Wurzel - hinter
    // Basic-Auth antwortete die Route in Produktion 401 (empirisch 2026-07-02),
    // der Host fiel auf einen generischen Platzhalter zurueck. Dieselbe enge
    // Ein-Pfad-Begruendung wie BRAND_ASSETS_PREFIX: ein statisches, oeffentliches
    // Marken-Asset, keine Nutzdaten.
    req.path === "/favicon.ico"
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

// Play-TTS-Seam: haelt vorab synthetisierte Agent-Audios kurz + einmalig (PII).
const ttsStore = createTtsStore({ ttlMs: config.elevenLabsPlayTts.tokenTtlMs });

// Play-TTS-Direktiven-Synth (fail-safe, Server-Slim P2): webt <Play>-Audio in Telnyx-
// Direktiven ein. Schliesst die EINE ttsStore-Instanz (INV-7) + config.
const directiveSynth = makeDirectiveSynth({ config, ttsStore });

// AUTH-AUSNAHME (Regel 3, begruendet): oeffentlich erreichbar, weil Telnyx diese URL
// SERVERSEITIG fetcht (kein Provider-Signatur-Header) - deshalb bewusst VOR der
// /voice-Signaturpruefung registriert (sonst 403). Loest KEINEN Call/keine SMS/keine
// Kosten aus (Regel 1 unberuehrt); die einzige Absicherung der PII-Audio ist der
// kryptografisch unratbare Token + kurze TTL + EINMALIGER Abruf (takeOnce). Kein Log
// von Token/Bytes (kein PII/Secret-Leak, Regel 4).
app.get("/voice/tts/:token", (req, res) => {
  const audio = ttsStore.takeOnce(req.params.token);
  if (!audio) return res.status(404).end();
  res.type(audio.contentType).send(audio.bytes);
});

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
  if (!ok) {
    // OBS-3: Ein fehlgeschlagener Provider-Signatur-Check war bisher stumm (nur 403) -
    // gedrehte Keys, ein falsch signierender Client oder gestoerte Zustellung blieben in
    // den Render-Logs unsichtbar (Regel 7). Genau EINE PII-/secret-freie Zeile: der
    // query-freie Pfad (kein PII) + die Provider-HERKUNFT als Enum-Token aus
    // providerFromHeaders (der EINZIGEN Header->Provider-Karte, G5) - NIE Header-Werte,
    // rawBody oder Timestamps (Regel 4). req.baseUrl+req.path statt nacktem req.path:
    // innerhalb von app.use("/voice", ...) ist req.path MOUNT-RELATIV (Express strippt
    // den "/voice"-Praefix), req.baseUrl liefert genau diesen Praefix zurueck - beide
    // zusammen ergeben den vollen, weiterhin query-freien Routen-Pfad. Additiv VOR dem
    // unveraenderten fail-closed-403.
    console.warn(
      `[voice-signature] ungueltige Inbound-Signatur -> 403 (path=${req.baseUrl}${req.path} provider=${providerFromHeaders(req.headers) || "unknown"})`,
    );
    return res.status(403).send("invalid inbound signature");
  }
  next();
});

// Voice-Render-Helfer (Server-Slim P3): render + Turn-/Say-/Stream-Direktiven leben
// jetzt in telephony/voice-render.js. EINE Instanz (INV-7), config wird geschlossen
// (publicUrl/sttSpeechTimeoutSec zur Laufzeit gelesen). Aufruf-Sites bleiben wortgleich;
// das voiceRender-Objekt geht in P11 an makeVoiceRoutes.
const voiceRender = makeVoiceRender({ config });
const { render, turnDirectives, sayInCallVoice, followupTurnDirectives, streamDirectives } = voiceRender;

// normNum (E.164-Normalisierung) lebt zentral in store/defaults.js (EINE Quelle,
// geteilt mit Seed + Profil-Allowlist) und wird oben importiert.

// Webhook-Parsing (Speech-Ergebnis/Lifecycle-Status/Speak-Outcome) lebt hinter dem
// WebhookEvents-Port (Port 5): webhookEvents(provider) aus telephony/registry.js,
// Implementierung je Provider in telephony/adapters/<provider>/webhook-events.js.

// ---- Eingabe-Validierung fuer API-Routen ----
// E164, TEXT_LIMITS, invalidText: extrahiert nach src/routes/_validation.js (T4 Phase 2).

// Gesprochene Degradations-/Reprompt-Texte fuer den /voice/turn-Fehlerpfad leben seit
// F1 P4 sprachabhaengig im Locale-Bundle (i18n/locales.js, eine Quelle pro Sprache):
//   llmDegradedSpeech  - wuerdevolles Ende bei anhaltender LLM-Nichtverfuegbarkeit
//                        (LlmUnavailableError aus dem resilienten Seam)
//   turnErrorSpeech    - generisches technisches Ende fuer jeden anderen Fehler
//   noSpeechReprompt   - knappe Rueckfrage, wenn der Gather leer lief (G4)
// Der Aufrufer hat call -> localeFor(call.language).<feld>. DE-Werte sind byte-identisch
// zum frueheren Inline-Bestand (i18n-Test pinnt sie).

// P8: TeXML-Handoff-Antwort auf /voice/incoming, wenn der Call-Control-Assistant den Leg
// uebernimmt. Leere Direktivenliste (renderDirectives([]) -> <Response></Response>) als
// Platzhalter; die exakte Telnyx-Handoff-Direktive ist live unbestaetigt (P0/P11). Zentral
// benannt statt inline-[] gestreut.
const INBOUND_ASSISTANT_HANDOFF = [];

// C-Telnyx-Inbound (P8, Befund 8): startet - falls einschlaegig - den Call-Control-Assistant
// fuer einen Inbound-Leg und liefert die Handoff-TeXML; sonst null (Aufrufer faellt fail-safe
// auf den bestehenden TeXML-Gather-Pfad zurueck). ERBT Signatur (app.use "/voice"), Tenant-
// Resolve (numberRecordByE164) UND Budget-Gate vom Aufrufer - KEIN neuer Gate, dieser Helper
// fuegt keinen hinzu. Nur bei aktivem Flag + signatur-authentifiziertem Telnyx-Provider
// (Anti-Spoof: provider stammt aus dem Signatur-Header, nicht aus To/Body). callControlId
// fehlt (Twilio ODER TeXML-Feld absent) -> null, kein kaputter Assistant-Pfad. Der Max-Dauer-
// Timer ist beim Aufrufer BEREITS armiert; terminateCappedCall liest den Call frisch und
// trifft via hangUpAction(callControlId) den Call-Control-Hangup, sobald callControlId
// persistiert ist (P6) - KEIN Re-Arm (zweiter Timer = Leak). Exakte Handoff-Direktive live
// unbestaetigt (wie P4-Adapter-Body-Form) - mit dem Owner in P0/P11 fixen.
async function inboundAssistantHandoffXml({ call, provider, body, greeting, voiceProfile }) {
  if (!(config.telnyxAssistant.enabled && provider === PROVIDER.TELNYX)) return null;
  const callControlId = inboundCallControlId(body);
  if (!callControlId) return null;
  await startInboundAiAssistant({ store, voiceControl, config, call, callControlId, greeting, voiceProfile });
  return render(INBOUND_ASSISTANT_HANDOFF, provider);
}

// ---------------- INBOUND ----------------
// Twilio-Nummer -> "A call comes in" -> POST {PUBLIC_URL}/voice/incoming
// Die Twilio-Signatur ist hier bereits fail-closed geprueft (app.use("/voice")).
// Erst danach wird To gelesen und auf einen Tenant aufgeloest (Anti-Spoof: To
// vor der Signatur waere Tenant-Spoofing). Unbekannte/fehlende To -> hoeflicher
// Hangup, KEIN Default-Tenant, KEIN aktiver Call (nicht-routbare Nummer kostet
// nichts).
app.post("/voice/incoming", async (req, res) => {
  // Provider EINMAL aus dem (bereits fail-closed signatur-geprueften) Header
  // ableiten. Skip-Signature/lokale curl-Tests ohne Provider-Header -> Default
  // twilio -> byte-identisch zum Bestand. Quelle ist der Signatur-Header, nicht
  // To/provider (Anti-Spoof: liegt strukturell HINTER der Signatur).
  const provider = providerFromHeaders(req.headers) ?? DEFAULT_PROVIDER;
  // S1-1: kompletter Handler-Body in try/catch. Seit await synthesizeDirectiveAudio
  // ist dieser Handler async - Express 4 faengt Promise-Rejections aus async-Handlern
  // NICHT ab, eine Exception ohne try/catch wuerde zur stillen unhandledRejection statt
  // einer Antwort, der eingehende Anruf haenge bis zum Provider-Timeout. call bleibt
  // ausserhalb sichtbar (let statt const), damit der Fehlerpfad - falls die Exception
  // erst NACH der Call-Erzeugung auftritt - dieselbe Sprache wie der Erfolgspfad
  // spricht; vor der Erzeugung faellt localeFor(undefined) fail-safe auf DE zurueck
  // (wie der Unrouted-Pfad unten).
  let call;
  try {
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

    call = store.createCall({
      direction: "inbound",
      from: req.body.From || "unbekannt",
      to,
      twilioSid: req.body.CallSid,
      tenantId,
      provider,
      language,
    });
    store.markAnswered(call.id);
    lifecycle.armMaxDurationTimer(call, req.body.CallSid);

    if (config.voiceEngine === "realtime") {
      return res.type("text/xml").send(render(streamDirectives(call), provider));
    }

    const ctx = store.tenantContext(call.tenantId);
    const greeting = ctx.settings.greeting.replaceAll("{owner}", ctx.ownerName);

    // P8: Handoff an den Call-Control-Assistant, falls einschlaegig; sonst (null) faellt
    // der Aufrufer fail-safe auf den bestehenden TeXML-Gather-Pfad zurueck (byte-identisch).
    const handoffXml = await inboundAssistantHandoffXml({
      call,
      provider,
      body: req.body,
      greeting,
      voiceProfile: locale.voiceProfile,
    });
    if (handoffXml) return res.type("text/xml").send(handoffXml);

    store.addTranscript(call.id, "agent", greeting);
    res
      .type("text/xml")
      .send(render(await directiveSynth.synthesizeDirectiveAudio(call, turnDirectives(call, greeting)), provider));
  } catch (err) {
    console.error("[incoming]", err.message);
    // S1-1: gracefuler Fehler-TeXML-Fallback statt haengendem Call (spiegelt /voice/turn,
    // Runde 2 S-A: sichtbar statt still). Kein LLM-Aufruf im Greeting-Pfad -> immer
    // turnErrorSpeech (kein llmDegradedSpeech-Fall wie bei /voice/turn). Vor der Call-
    // Erzeugung gibt es noch kein call.provider fuer synthesizeDirectiveAudio (der Guard
    // dort wuerde selbst werfen) -> reines Azure-<Say> wie der Unrouted-Pfad oben.
    const locale = localeFor(call?.language);
    const errorDirectives = [sayD(locale.turnErrorSpeech, locale.voiceProfile), hangupD()];
    const outDirectives = call ? await directiveSynth.synthesizeDirectiveAudio(call, errorDirectives) : errorDirectives;
    res.type("text/xml").send(render(outDirectives, provider));
  }
});

// ---------------- GESPRAECHS-TURN (Budget-Engine, beide Richtungen) ----------------
app.post("/voice/turn", async (req, res) => {
  let call = store.getCall(req.query.callId);
  if (!call || call.status !== "active") {
    // F12 (A6): dem Prozess unbekannter, aber in der DB aktiver Call (Deploy-Instanz-
    // wechsel)? Erst RLS-sauber re-attachen+klassifizieren, DANN erst fail-closed auflegen.
    const reattached = await lifecycle.reattachActiveCall(req.query.callId);
    if (reattached.call) {
      call = reattached.call; // aktiver Call, Cap re-armiert -> normal fortfahren
    } else {
      // Fail-closed Hangup wie im Bestand, aber NICHT mehr still (Runde 2, S-A):
      // dieses Muster entsteht real, wenn ein Deploy-Instanzwechsel den in-memory-
      // Call verliert (Testanruf call_mr3lg2g7t9zg) - ohne Logzeile ist der Vorfall
      // in den Render-Logs unsichtbar (CLAUDE.md Regel 7). callId ist server-
      // generiert, kein PII. Anders als /voice/status (Rauschen) ist ein Turn-
      // Webhook ohne aktiven Call IMMER ein totes Live-Gespraech.
      // Warn-Log NUR bei echt unbekanntem Call - ein terminalisiertes Ueber-Zeit-Leg
      // (logUnknown:false) WAR aktiv, "kein aktiver Call" waere dort irrefuehrend (G2).
      if (reattached.logUnknown)
        console.warn(
          `[voice/turn] kein aktiver Call (callId=${req.query.callId || "-"} ${call ? `status=${call.status}` : "unbekannt"}) -> Hangup`,
        );
      return res.type("text/xml").send(render([hangupD()]));
    }
  }
  // L0: Luecke seit dem Render des vorigen Folge-Gathers ~ STT-Finalisierungs-Totzeit.
  metrics.logTurnGap(call.id);

  const heard = webhookEvents(call.provider).parseSpeechResult(req.body);
  try {
    // G3/G26-Fix (Runde 2): callerHasSpoken (claude.js) statt blosser Zeilen-Existenz -
    // sonst haette outbound schon ein einzelnes aufgezeichnetes Rausch-/Echo-Fragment
    // diesen Kurzschluss fuer den Rest des Calls vor agentTurn gestellt und den R4-Empty-
    // Turn-Zaehler (unansweredAgentTurns, nur bei echtem agentTurn-Aufruf neu ausgewertet)
    // dauerhaft eingefroren (siehe Kommentar an callerHasSpoken).
    if (!heard && callerHasSpoken(call)) {
      metrics.recordTurnRendered(call.id); // L0: Folge-Gather offen -> Render-Zeitpunkt
      const reprompt = followupTurnDirectives(call, localeFor(call.language).noSpeechReprompt);
      return res
        .type("text/xml")
        .send(render(await directiveSynth.synthesizeDirectiveAudio(call, reprompt), call.provider));
    }
    const { speech, endCall } = await agentTurn(call, heard || null);
    const directives = endCall
      ? [sayInCallVoice(call, speech), hangupD()]
      : followupTurnDirectives(call, speech);
    if (!endCall) metrics.recordTurnRendered(call.id); // L0: nur wenn ein Folge-Turn folgt
    res
      .type("text/xml")
      .send(render(await directiveSynth.synthesizeDirectiveAudio(call, directives), call.provider));
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
    const speech = degradedSpeechFor(err, locale);
    const errorDirectives = [sayInCallVoice(call, speech), hangupD()];
    res
      .type("text/xml")
      .send(render(await directiveSynth.synthesizeDirectiveAudio(call, errorDirectives), call.provider));
  }
});

// ---------------- OUTBOUND: Angerufener nimmt ab ----------------
app.post("/voice/outbound", async (req, res) => {
  let call = store.getCall(req.query.callId);
  if (!call) {
    // F12 (A6): siehe /voice/turn - erst re-attachen+klassifizieren, dann fail-closed.
    const reattached = await lifecycle.reattachActiveCall(req.query.callId);
    if (reattached.call) {
      call = reattached.call;
    } else {
      // Sichtbarer fail-closed Hangup (Runde 2, S-A) - Begruendung siehe /voice/turn.
      if (reattached.logUnknown)
        console.warn(`[voice/outbound] unbekannter Call (callId=${req.query.callId || "-"}) -> Hangup`);
      return res.type("text/xml").send(render([hangupD()]));
    }
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
  res
    .type("text/xml")
    .send(
      render(await directiveSynth.synthesizeDirectiveAudio(call, turnDirectives(call, opening)), call.provider),
    );
});

app.post("/voice/status", async (req, res) => {
  res.sendStatus(200);
  let call = store.getCall(req.body.CallSid) || store.getCall(req.query.callId || "");
  if (!call) {
    // F12 (A6) Runde 2 (S1-1): denselben reattachActiveCall()-Pfad wie /voice/turn und
    // /voice/outbound nutzen - NICHT store.attachActiveCall direkt. Ein direkter Aufruf
    // wuerde ein Ueber-Zeit-Leg (Deploy-Instanzwechsel liefert answered/completed verspaetet)
    // OHNE Restzeit-Pruefung und OHNE Timer-Rearm als aktiv in den Spiegel zurueckholen -
    // der Call liefe danach fuer den Rest seiner Lebensdauer OHNE Max-Dauer-Cap (Regel 1),
    // weil ein folgendes /voice/turn ihn dann schon aktiv im Spiegel findet und
    // reattachActiveCall nie wieder aufruft. RLS-scoped, nur DB-bestaetigt (nie der Body).
    const reattached = await lifecycle.reattachActiveCall(req.query.callId || "");
    // Beide null-Faelle bleiben still (Bestand: kein PII/Debug-Rauschen): logUnknown=true
    // -> wirklich unbekannt; logUnknown=false -> Ueber-Zeit-Leg wurde bereits terminalisiert
    // + gebucht (terminateCappedCall), hier ist nichts mehr zu tun.
    if (!reattached.call) return;
    call = reattached.call;
  }
  const provider = call.provider || DEFAULT_PROVIDER;

  // TTS-Stoerung sichtbar machen (graceful degradation): Telnyx meldet ein
  // fehlgeschlagenes server-seitiges TTS (<Say> ueber Azure-NTTS) als Command-Event
  // OHNE CallStatus. Ein solches Event ist KEIN Lifecycle-Uebergang -> hier terminieren,
  // sonst wuerde es mit status=undefined faelschlich als Lifecycle-Event geloggt. Nur
  // der Fehlschlag wird geloggt (OK-Speak waere Rauschen) und macht die sporadische
  // Azure-Stoerung zum diagnostizierbaren, PII-freien Signal (reason = Telnyx-Token).
  const speak = webhookEvents(provider).parseSpeakOutcome(req.body);
  if (speak.outcome !== SPEAK_OUTCOME.NONE) {
    if (speak.outcome === SPEAK_OUTCOME.FAILED)
      console.error(
        "[voice/speak]",
        JSON.stringify({ callId: call.id, provider, outcome: speak.outcome, reason: speak.reason }),
      );
    return;
  }

  const { status: callStatus, diagnostics } = webhookEvents(provider).parseLifecycleEvent(req.body);
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
  // CDF1: maschinenlesbaren Fehlergrund aus der bereits berechneten Diagnose persistieren
  // (PII-frei). completed -> callFailureReason null -> recordFailureReason No-op (kein Save).
  store.recordFailureReason(call.id, callFailureReason({ status: callStatus, diagnostics }));
  // C5 (Struct-4): Settlement-Gateway statt manuellem endCallRecord+finishCall-Paar - bill
  // (Settlement) ist bei terminateAndBillCall ein strukturell erzwungenes Pflichtfeld (Fail-
  // Fast-Guard, verhindert die C5-Bugklasse: ein neuer Terminierungspfad vergisst finishCall).
  // hangUp:null: der Provider hat den Call bereits beendet (dieses Event IST der Hangup), kein
  // eigener Hangup-Versuch noetig (bereits getesteter Zweig, call-termination-order.test.js).
  await terminateAndBillCall({
    persistEnd: () => {
      if (call.status === "active")
        store.endCallRecord(call.id, callStatus === "completed" ? "completed" : "failed");
    },
    hangUp: null,
    bill: billThunk(callFinish.finishCall, store, call.id),
    callId: call.id, // P8: Settlement-Fehler-Log (terminateAndBillCall) mit Korrelation
  });
});

// Call-Control-Event-Ingest (P4.5): additiv, liegt UNTER app.use("/voice") -> Ed25519
// fail-closed (Regel 3). Faehrt die event-getriebene Zustandsmaschine (answered->
// Opening-Speak (Offenlegung+Anliegen); speak.ended->ai_assistant_start; hangup->Settlement
// finishCall). Korrelation ueber ?callId (Muster /voice/status), KEIN Store-Sekundaerindex.
// Der bestehende Budget/TeXML-Pfad (/voice/status|turn|outbound) bleibt byte-identisch.
app.post(
  "/voice/call-control",
  makeCallControlIngest({
    store,
    voiceControl,
    finishCall: callFinish.finishCall,
    openingText,
    localeFor,
    reattachActiveCall: lifecycle.reattachActiveCall,
    watchdog: conversationWatchdog,
    config,
  }),
);

// ================= REST-API (Dashboard + MCP-Tools) =================

// I10 (call-quality Impl-1): additives Meta in der /api/calls-Erfolgsantwort - zeigt dem
// aufrufenden MCP-Client (place_call), WAS vom optionalen context tatsaechlich ankam.
// NUR bool/count, NIE der Kontext-Inhalt selbst (kein zweiter Transportweg fuer
// HINTERGRUND-Daten). active=false, wenn der Kanal komplett abgeschaltet ist
// (config.assistantContextEnabled aus - context ist dann IMMER null, s.o.).
function contextReceivedMeta(context) {
  return {
    active: config.assistantContextEnabled,
    summary: !!context?.summary,
    key_facts_count: Array.isArray(context?.key_facts) ? context.key_facts.length : 0,
    recipient_relationship: !!context?.recipient_relationship,
    desired_outcome: !!context?.desired_outcome,
  };
}

// Outbound-Call starten (Vertrag laut Brief: objective/briefing/constraints/...)
app.post("/api/calls", async (req, res) => {
  const b = req.body || {};
  let to = normNum(b.to);
  const objective = b.objective || b.goal;
  if (!to || !objective) return res.status(400).json({ error: "to und objective sind Pflicht" });
  // C4 (6.6): 400 VOR jedem Gate und vor dem Dial; 400 = reiner Eingabefehler -> kein Audit
  // (wie die to/objective-Pruefung oben).
  if (isTrunkZeroFormatError(to)) return res.status(400).json({ error: E164_FORMAT_ERROR });

  // Geordnete Safety-/Geld-Gate-Kette (EINE Schleife, EIN Array, Struct-1 P6). ctx
  // transportiert Derivationen (normalisiertes to, tenantId, Absendernummer, Reserve)
  // zwischen den Gates; volle Reihenfolge + Rationale in telephony/outbound-gates.js.
  const ctx = { req, to, objective, b };
  for (const gate of outboundGates) {
    const denial = await gate.run(ctx);
    if (denial) {
      if (denial.audit) audit(denial.audit.event, req, denial.audit.detail);
      return res.status(denial.status).json(denial.body);
    }
  }

  // Ab hier ist ctx vollstaendig durch die Gate-Kette befuellt. KRITISCH: ctx.to ist die von
  // normalize_target aufgeloeste Nummer - die lokale `to` bleibt roh und wird ab hier NICHT
  // mehr gelesen.
  const language = store.resolveCallLanguage({ tenantId: ctx.tenantId, numberRecord: ctx.numberRecord });
  // Der /voice/outbound-Webhook rendert dank call.provider (P6a) automatisch TeXML
  // statt TwiML.
  const call = store.createCall({
    direction: "outbound",
    from: ctx.fromNumber,
    to: ctx.to,
    goal: ctx.objective,
    briefing: b.briefing,
    constraints: b.constraints,
    context: ctx.context,
    language,
    maxDurationS: ctx.maxDur,
    requestedBy: ctx.requestedBy,
    tenantId: ctx.tenantId,
    provider: ctx.outboundProvider,
    reserveCents: ctx.reserveCents, // OUT-05 (F2)
  });
  audit(
    "place_call",
    req,
    `to=${ctx.to} call=${call.id} provider=${ctx.outboundProvider} requestedBy=${ctx.requestedBy}`,
  );

  try {
    // C-Telnyx (P5): Call-Control-Origination HINTER der kompletten, unveraenderten Gate-
    // Kette (KEIN zweiter Einstieg, Regel 1). Verzweigt NUR bei aktivem Flag + Telnyx-
    // Provider; sonst TeXML byte-identisch. Flag Default aus -> Live-Pfad unveraendert bis P11.
    if (config.telnyxAssistant.enabled && ctx.outboundProvider === PROVIDER.TELNYX) {
      await originateAiAssistantCall({
        store,
        voiceControl,
        config,
        call,
        fromNumber: ctx.fromNumber,
        to: ctx.to,
        maxDur: ctx.maxDur,
      });
      // P6 (Regel 1, Minuten-Achse): harter Max-Dauer-Cap AUCH fuer C-Telnyx. originateAiAssistantCall
      // hat call.callControlId persistiert+gespeichert; terminateCappedCall liest sie beim Feuern
      // frisch und waehlt via hangUpAction den Call-Control-Hangup (endCallViaCallControl), NICHT
      // TeXML-endCall. providerCallSid=null ist Absicht (es gibt keinen twilioSid; die ID kommt
      // aus callControlId). KEIN realtime-Guard: ein C-Telnyx-Call laeuft NICHT ueber die
      // Realtime-Bridge (kein Media-Stream) -> dieser Timer ist neben time_limit_secs der
      // EINZIGE in-Prozess-Cap (fail-closed, Regel 1).
      lifecycle.armMaxDurationTimer(call, null);
    } else {
      const tw = await voiceControl(ctx.outboundProvider).originateCall({
        from: ctx.fromNumber,
        to: ctx.to,
        url: `${config.publicUrl}/voice/outbound?callId=${call.id}`,
        statusCallback: `${config.publicUrl}/voice/status?callId=${call.id}`,
        statusCallbackEvent: ["answered", "completed"],
        method: "POST",
        timeLimit: ctx.maxDur,
      });
      call.twilioSid = tw.sid;
      store.save();
      // Max-Dauer hart durchsetzen (Budget-Engine). Fuer Twilio redundant zum
      // timeLimit-Param, fuer Telnyx (TeXML-Pfad) der einzige verlaessliche Cap. Erst NACH
      // erfolgreichem Originate armen (vorher gibt es keinen providerCallSid).
      if (config.voiceEngine !== "realtime") lifecycle.armMaxDurationTimer(call, tw.sid);
    }
    lifecycle.armReserveReleaseTimer(call); // OUT-05 (F2): Reserve-Backstop, BEIDE Pfade, nach erfolgreichem Originate
    res.json({
      ok: true,
      callId: call.id,
      twilioSid: call.twilioSid,
      status: "dialing",
      context_received: contextReceivedMeta(ctx.context), // I10
    });
  } catch (err) {
    // C5 (Struct-4): die eigentliche Luecke - bisher lief hier NIE finishCall (Settlement/
    // Notification fehlten komplett bei einem Dial-Fehlschlag), und releaseReserve wurde
    // manuell dupliziert obwohl finishCall es bereits idempotent selbst aufruft (S2,
    // reserveReleased-Guard in state-ops.js). Jetzt derselbe Gateway wie die anderen 4
    // Terminierungspfade; hangUp:null (kein Dial = kein Provider-Leg zum Auflegen).
    await terminateAndBillCall({
      persistEnd: () => store.endCallRecord(call.id, "failed"),
      hangUp: null,
      bill: billThunk(callFinish.finishCall, store, call.id),
      callId: call.id, // P8: Settlement-Fehler-Log (terminateAndBillCall) mit Korrelation
    });
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
    if (ctx.outboundProvider === "twilio") {
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
  // F10 Runde 2 (G5): derselbe Terminierungspfad wie der Max-Dauer-Cap - erst auflegen
  // (awaited, provider-aware ueber call.provider - sonst Twilio-endCall auf einem
  // Telnyx-Call), dann buchen (fire-and-forget).
  await terminateAndBillCall({
    persistEnd: () => store.endCallRecord(call.id, "cancelled"),
    // P6 (Check 5): dieselbe callControlId-/twilioSid-Auswahl wie terminateCappedCall (G5,
    // EINE Quelle) - cancel_call eines C-Telnyx-Calls trifft den Call-Control-Hangup.
    hangUp: hangUpAction(voiceControl, call, call.twilioSid),
    bill: billThunk(callFinish.finishCall, store, call.id),
    onHangUpError: (e) => console.error("[cancel]", e.message),
    callId: call.id, // P8: Settlement-Fehler-Log (terminateAndBillCall) mit Korrelation
  });
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

// ---- Tenant-Write-Routen (Server-Slim P8) ---------------------------------------
// Die tenant-scoped Schreib-Route-Gruppe (POST /api/settings,
// POST /api/action-items/:id/toggle, POST /api/calendar) lebt jetzt in
// src/routes/api-tenant-write.js (makeTenantWriteRoutes, DI-Muster wie makeReadRoutes)
// - reine Verschiebung, Verhalten unveraendert. An unveraenderter Mount-Position (nach
// makeReadRoutes, vor makeProfileRoutes), hinter Basic-Auth (Bestand deckt /api/* ab).
// requireTenant = die EINE Wurzel-Instanz (403 bei TENANT_REJECT); die handler-interne
// Reihenfolge (requireTenant -> allowBooking -> Validierung) ist exakt mitgewandert.
// internalIdentity/OWNER_ID injiziert (EINE Quelle, request-tenant.js).
app.use(
  makeTenantWriteRoutes({
    store,
    audit,
    tenant: { requireTenant },
    internalIdentity,
    OWNER_ID,
  }),
);

// ---- Rechteprofile verwalten (Phase 2) ----
// AC7-Decomposition: die /api/profiles-Route-Gruppe lebt jetzt in
// src/routes/api-profiles.js (makeProfileRoutes, DI-Muster wie makeWebAuthRoutes) -
// reine Verschiebung, Verhalten unveraendert. validIdentity wird von dort importiert
// (eine Quelle, G5) und unten in /api/onboard weiterverwendet.
// Hinter Basic-Auth (Bestand deckt /api/* ab); KEIN MCP-Tool (s. Modul-Kommentar).
app.use(makeProfileRoutes({ store, audit }));

// ---- Billing-Routen (Server-Slim P7) --------------------------------------------
// Die /api/billing/*-Route-Gruppe (flush-meters, setup-checkout, checkout-return)
// lebt jetzt in src/routes/api-billing.js (makeBillingRoutes, DI-Muster wie
// makeReadRoutes) - reine Verschiebung, Verhalten unveraendert. An unveraenderter
// Mount-Position (nach makeProfileRoutes, vor /api/onboard), hinter Basic-Auth
// (Bestand deckt /api/* ab). billing = stripeBilling (EINE Instanz, INV-7);
// requireTenant = die EINE Wurzel-Instanz (403 bei TENANT_REJECT). Der Safety-Kontext
// (kein MCP-Tool, PAYMENT_ENABLED-404-Gate) ist ins Modul mitgewandert.
app.use(
  makeBillingRoutes({
    config,
    store,
    audit,
    billing: stripeBilling,
    tenant: { requireTenant },
  }),
);

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

  // Onboard-Guard (tenant-prolif-b): reine Bedingungspruefung in onboard-guard.js
  // (isoliert unit-testbar), hier nur die IO-Verdrahtung (audit + Response). Fail-closed:
  // 409, kein zweiter Tenant, kein Nummer-Request. PII-frei (kein sub im Body/Log).
  // resolveTenant ist ein reiner Lese-Check (kein Store-Lock noetig; Operator-only,
  // geringe Nebenlaeufigkeit).
  const onboardGuardHit = checkSubAlreadyMerged({
    sub,
    tenantId,
    resolveTenant: store.resolveTenant,
  });
  if (onboardGuardHit) {
    audit("onboard_denied", req, `tenant=${tenantId} grund=sub_already_merged`);
    return res.status(onboardGuardHit.status).json({ error: onboardGuardHit.error });
  }

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
      // Fix B (G5/S2): Persistenz-Entscheidung geteilt mit triggerTenantProvisioning
      // (shouldPersistProvisionResult, EINE Quelle statt woertlicher Duplizierung).
      if (shouldPersistProvisionResult(r)) store.save(); // 'requested' persistieren (auch im Dry-Run)
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
  const jobRes = await provisioning.queueProvisioning(numberId, tenantId);
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
  void provisioning.runProvisioningDrainExclusive();
});

// Operator-Re-Trigger (P2): provisioniert eine NEUE Nummer fuer einen aktiven, bezahlten
// Subscriber, dessen vorheriger Nummernkauf scheiterte (provisionNumber faellt bei Order-/
// Hold-Fehler auf 'failed' -> tenantHasLiveNumber wird wieder offen -> frische 'requested'
// -> Worker kauft). Hinter der globalen Basic-Auth (Owner) ODER trusted-localhost wie alle
// /api/* (Regel 3). Geld-Safety (Regel 1): NUR fuer einen active + KYC>=CARD Subscriber
// (das Abo IST die Freigabe, dieselbe Semantik wie das Outbound-Allowlist-Gate) - kein
// Nummernkauf fuer Nicht-Zahler/suspendierte/fremde Tenants. Reuse triggerTenantProvisioning
// (alle Gates: PROVISIONING_ENABLED, Caps, tenantHasLiveNumber, Hold/Capture) - keine zweite
// Kauflogik (G5). 'already_provisioned' = Tenant hat schon eine lebende Nummer (idempotent).
const RETRY_REASON_STATUS = {
  already_provisioned: 409,
  tenant_cap: 409,
  global_cap: 429,
  needs_manual_reconcile: 409,
  persist_error: 503,
};
// Runbook-Hinweis fuer needs_manual_reconcile (PROV-01/F7): ein zu alter / alters-unbekannter
// stuck-Job liegt evtl. AUSSERHALB des Anbieter-Idempotenz-Fensters (Doppelkauf-Gefahr) -> KEIN
// Auto-Retry. Der Owner muss den Provider-/Stripe-Zustand manuell abgleichen. Andere Gruende
// nutzen den generischen Template-Text (EINE Quelle, Fallback unten).
const RETRY_REASON_MESSAGE = {
  needs_manual_reconcile:
    "Haengender Nummernkauf ausserhalb des sicheren Nachfuehr-Fensters - " +
    "bitte Provider-/Stripe-Zustand manuell abgleichen (Runbook PROV-01), kein Auto-Retry.",
};
app.post("/api/onboard/retry", async (req, res) => {
  const { tenantId } = req.body || {};
  if (!validIdentity(tenantId))
    return res
      .status(400)
      .json({ error: "tenantId ist Pflicht (nicht leer, ohne Whitespace, <=254 Zeichen)" });
  // Geld-Safety (Regel 1): nur ein aktiver, KYC-verifizierter Subscriber - verhindert, dass
  // der Owner versehentlich Geld fuer einen Fremd-/suspendierten/Nicht-Zahler-Tenant ausgibt.
  if (!store.tenantActiveSubscriber(tenantId, KYC_OUTBOUND_MIN)) {
    audit("onboard_retry_denied", req, `tenant=${tenantId} grund=kein_aktiver_subscriber`);
    return res
      .status(403)
      .json({ error: "Kein aktiver, verifizierter Subscriber - kein Nummernkauf." });
  }
  const result = await provisioning.triggerTenantProvisioning(tenantId);
  audit("onboard_retry", req, `tenant=${tenantId} ok=${result.ok} grund=${result.reason}`);
  if (!result.ok)
    return res
      .status(RETRY_REASON_STATUS[result.reason] || 400)
      .json({
        error: RETRY_REASON_MESSAGE[result.reason] || `Re-Provisioning abgelehnt (${result.reason})`,
      });
  res.json({ tenantId, numberId: result.numberId, reason: result.reason, jobId: result.jobId });
});

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
  // Identitaet aus dem verifizierten JWT (req.auth). email bevorzugt, sonst sub. Sie wird
  // als X-Internal-Identity an die In-Process-Tools gereicht (Audit/requestedBy) - NICHT
  // mehr fuer das Rechteprofil. Kein req.auth (Legacy/localhost/stdio) -> null.
  const identity = req.auth ? req.auth.email || req.auth.sub || ANON_IDENTITY : null;
  // Rechteprofil keyt seit Phase S auf den am Gateway aufgeloesten Tenant (scopedTenant),
  // nicht auf die email-/sub-Identitaet. BOOTSTRAP -> OWNER_PROFILE, sonst stored-or-DEFAULT
  // (fail-closed: ein authentifizierter Nutzer ohne Tenant-Profil bekommt DEFAULT_PROFILE).
  const profile = store.resolveProfile(scopedTenant);
  try {
    // Rich-UI: Server deklariert die io.modelcontextprotocol/ui-Extension im initialize-
    // Response (MCP Apps / SEP-1865 - PFLICHT, sonst rendert der Host das ui://-Widget
    // NICHT, auch bei korrektem Tool-_meta). Nur bei aktivem Master-Schalter; aus ->
    // keine Extension -> byte-identisch. Auto-registrierte tools/resources werden vom SDK
    // dazugemerged (verdraengen die Extension nicht).
    const serverOptions = config.mcpUiEnabled
      ? { capabilities: { extensions: uiServerExtension() } }
      : undefined;
    const server = new McpServer(HERMES_SERVER_INFO, serverOptions);
    // Rich-UI-Host-Hinweis: gegated NUR durch den Master-Schalter config.mcpUiEnabled
    // (aus -> uiHost.enabled=false -> Stufe-0-only, byte-identisch). Der MCP-native
    // Renderer ist der Default (siehe ui/registry.js); kein per-Request-Capability-Gate
    // mehr, weil der stateless Transport (sessionIdGenerator=undefined) die initialize-
    // Capabilities nicht zum tools/list-POST mitfuehrt - das Widget-_meta erschien sonst
    // NIE. capabilities dienen nur noch der expliziten ChatGPT-Adapter-Wahl. Kein neuer
    // Endpunkt, mcpAuth + res.on("close")-Cleanup unveraendert.
    const uiHost = { enabled: config.mcpUiEnabled, capabilities: req.body?.params?.capabilities };
    registerTools(server, {
      identity,
      scopedTenant,
      allowCalendar: profile.allowCalendar,
      uiHost,
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

// Boot-Haertung (OUT-05, F2): FAKE_ORIGINATE nur mit geskippter Signaturpruefung zulaessig ->
// in Prod (Signatur fail-closed AN, Regel 1) Boot-Refusal statt stillem Nicht-Waehlen.
if (fakeOriginateBootBlocked(config)) {
  console.error(
    "[boot] Start abgebrochen: FAKE_ORIGINATE=true ist nur mit SKIP_TWILIO_SIGNATURE_CHECK=true " +
      "zulaessig (Test-Seam, in Produktion unzulaessig).",
  );
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

// F10-ORD (Review-Blocker Runde 1): rearmActiveCallTimers() laeuft ERST HIER, NACH
// allen Boot-Gates (assertConfig/fakeOriginateBootBlocked/hasActiveNumber), unmittelbar
// VOR app.listen. Vorher (VOR assertConfig) haette ein Zombie-Call bereits
// store.setCallEndedAt() + den synchronen Teil von finishCall (Buchung/markBilled)
// ausgeloest, BEVOR ein scheiterndes assertConfig() im selben Tick process.exit(1)
// feuert - der async-Rest von finishCall (releaseReserve/store.save/Notification/SMS)
// liefe dann NIE mehr, der Call bliebe teilgebucht+Reserve-nie-freigegeben auf Platte
// stehen. Das widerspraeche dem Boot-Gate-Versprechen "GAR NICHT gestartet" (Regel 1/
// OT-4). Kein Gate danach darf mehr process.exit(1) rufen.
lifecycle.rearmActiveCallTimers();

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
  // PROV-01/F5: Crash-verwaiste Provisioning-Jobs beim Boot reconcilen. Fire-and-forget NACH
  // den Boot-Logs - blockiert weder listen noch Healthcheck; der Boot-Guard (hasActiveNumber)
  // lief bereits davor. Gated auf PROVISIONING_ENABLED, Default Observe-Only (maxAge=0).
  void provisioning.reconcileOrphanedProvisioning();
});

// Audio-Bridge (nur relevant bei VOICE_ENGINE=realtime)
attachMediaBridge(httpServer, callFinish.finishCall);

// F11 (A6): Graceful Shutdown. Ein Deploy/Restart schickt SIGTERM (Render), Ctrl+C SIGINT.
// OHNE Handler killt Node den Prozess sofort -> ein in-flight /voice/turn stirbt mitten im
// LLM-await (Agent-Transkript nie persistiert, keine TwiML-Antwort). Der Drain laesst laufende
// Requests fertig laufen (await close) und flusht ERST DANACH den Store. Das ORDERING ist
// entscheidend: kein Handler darf NACH dem finalen save() noch eine Mutation anhaengen.
// Watchdog kappt einen haengenden Drain hart mit exit(0). shuttingDown schuetzt gegen
// Wiedereintritt (zweites Signal / SIGTERM+SIGINT). Secret-frei (nur Signalname).
//
// Review-Blocker Runde 1 (F11):
// S1-A: closeIdleConnections() MUSS unmittelbar NEBEN dem close(resolve)-Aufruf stehen,
// NICHT erst nach dessen await. server.close() loest seinen Callback erst auf, wenn die
// Verbindungszaehlung auf 0 steht - inklusive idler Keep-Alive-Sockets, die Node sonst
// erst nach keepAliveTimeout von selbst schliesst. Haelt z.B. ein Health-Checker eine
// staendig erneuerte Keep-Alive-Verbindung offen, wuerde "await close()" NIE von selbst
// aufloesen, wenn closeIdleConnections() erst danach kaeme (Aufruf ohne Wirkung).
// S1-B: store.save() haengt beim pg-Backend seinen DB-Write an eine asynchrone
// flushChain und gibt nur EINE fruehe Referenz zurueck. Ein waehrend des Await feuernder
// Hintergrund-Timer (Max-Dauer-Cap/Reserve-Release, unabhaengig von HTTP-Verbindungen)
// kann seinen eigenen Flush HINTER dieser Referenz anhaengen - store.drainFlushes()
// loopt, bis die Kette nachweislich stabil ist, bevor process.exit(0) faellt.
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] Signal ${signal} - draine in-flight Requests, dann finaler Store-Flush`);
  const watchdog = setTimeout(() => process.exit(0), config.shutdownDrainTimeoutMs).unref();
  const closed = new Promise((resolve) => httpServer.close(resolve));
  if (typeof httpServer.closeIdleConnections === "function") httpServer.closeIdleConnections();
  await closed;
  await store.save();
  await store.drainFlushes();
  clearTimeout(watchdog);
  process.exit(0);
}
process.once("SIGTERM", gracefulShutdown);
process.once("SIGINT", gracefulShutdown);

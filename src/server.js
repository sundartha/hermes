// Voice-Gateway: Twilio-Webhooks (Inbound/Outbound), Audio-Bridge (Realtime),
// MCP ueber Streamable HTTP (/mcp), REST-API fuer Dashboard & stdio-MCP.
// MUSS erste Importzeile bleiben (vor store.js) - globales Crash-Netz, ESM-Eval-Order (T-P0-07).
import "./process-guards.js";
import path from "path";
import express from "express";
import { config, assertConfig } from "./config.js";
import * as store from "./store.js";
import {
  PROVIDER,
  NUMBER_STATUS,
  USAGE_EVENT_KIND,
} from "./store/defaults.js";
import { hasActiveNumber } from "./store/views.js";
import { planSummarySms } from "./sms-summary.js";
import { agentTurn, summarizeCall } from "./claude.js";
import { makeTelnyxLlmShim } from "./telnyx-llm-shim.js";
import { makeConversationWatchdog, WATCHDOG_LOG_PREFIX } from "./telnyx-conversation-watchdog.js";
import { makeCallControlTerminator } from "./telnyx-call-terminate.js";
import { originateAiAssistantCall } from "./telnyx-origination.js";
import { BRAND_ASSETS_PREFIX } from "./mcp-server-info.js";
import { attachMediaBridge } from "./bridge.js";
import { createTtsStore } from "./tts/store.js";
import { makeDirectiveSynth } from "./tts/directive-synth.js";
import { createRateLimiter, securityHeaders, errorHandler } from "./middleware.js";
import { registerWellKnown } from "./auth.js";
import { audit, safeEqual } from "./util.js";
import {
  voiceControl,
  messaging,
  webhookEvents,
  inboundSignatureVerifier,
  providerFromHeaders,
  numberProvisioning,
} from "./telephony/registry.js";
import { makeVoiceRender } from "./telephony/voice-render.js";
import { localeFor } from "./i18n/locales.js";
import { terminateAndBillCall, hangUpAction, billThunk } from "./telephony/call-termination.js";
import { makeCallFinish } from "./telephony/call-finish.js";
import { makeOutboundGates } from "./telephony/outbound-gates.js";
import { reattachActiveCall as reattachActiveCallCore } from "./telephony/reattach.js";
import { makeCallLifecycle } from "./telephony/call-lifecycle.js";
import {
  setTenantIdentityIfAbsent,
  recordProvisioningJob,
  markProvisioningJob,
  classifyQueuedProvisioningJobs,
  findNumber,
  classifyCallTime,
  cappedEndedAtMs,
} from "./store/state-ops.js";
import { handleProvisionJob } from "./worker/provisioning.js";
import { makeProvisioningOrchestrator } from "./worker/provisioning-orchestrator.js";
import { resolveProvisionRetry } from "./billing/provision-trigger.js";
import { createQueue } from "./queue/registry.js";
import { stripeBilling } from "./billing/stripe.js";
import { makeMetering } from "./billing/metering.js";
import { verifyStripeSignature, applyStripeWebhookSerialized } from "./billing/webhook.js";
import { makeVoiceRoutes } from "./routes/voice.js";
import { makeReadRoutes } from "./routes/api-read.js";
import { makeTenantWriteRoutes } from "./routes/api-tenant-write.js";
import { makeSelfServiceRoutes } from "./self-service-routes.js";
import { makeProfileRoutes } from "./routes/api-profiles.js";
import { makeBillingRoutes } from "./routes/api-billing.js";
import { makeCallRoutes } from "./routes/api-calls.js";
import { makeOnboardRoutes } from "./routes/api-onboard.js";
import { makeMcpRoutes } from "./routes/mcp.js";
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
// internalIdentity sowie OWNER_ID/TENANT_REJECT kommen aus demselben
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
// EINE Instanz: dieselbe finishCall-Referenz geht an attachMediaBridge UND - via
// makeVoiceRoutes - makeCallControlIngest
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

// Voice-Render-Helfer (Server-Slim P3): EINE Instanz (INV-7), config wird geschlossen.
// Geht als Dep an makeVoiceRoutes (P11); die Render-Funktionen werden dort destrukturiert.
const voiceRender = makeVoiceRender({ config });

// ---- Voice-Webhooks (Server-Slim P11) ---------------------------------------------
// Alle /voice/* (GET /voice/tts/:token, app.use("/voice",sig-MW), incoming/turn/outbound/
// status/call-control) leben jetzt in routes/voice.js (makeVoiceRoutes, DI-Muster wie
// makeCallRoutes) - REINE Verschiebung. Mount an UNVERAENDERTER Position: nach
// express.static(publicDir), vor makeCallRoutes (INV-2). /voice ist Auth-Gate-exempt
// (Sig fail-closed). INV-4: TTS-Route VOR der Sig-MW (im Router festgehalten). finishCall
// = die EINE callFinish-Instanz (INV-7); watchdog = der EINE conversationWatchdog (geteilt
// mit dem Shim); voiceRender/directiveSynth/ttsStore/lifecycle = die EINEN Wurzel-Instanzen.
app.use(
  makeVoiceRoutes({
    store,
    config,
    audit,
    voiceRender,
    directiveSynth,
    ttsStore,
    lifecycle,
    finishCall: callFinish.finishCall,
    voiceControl,
    webhookEvents,
    providerFromHeaders,
    inboundSignatureVerifier,
    terminateAndBillCall,
    billThunk,
    watchdog: conversationWatchdog,
  }),
);

// ================= REST-API (Dashboard + MCP-Tools) =================

// ---- Outbound-Call-Routen (Server-Slim P9) --------------------------------------
// Die Outbound-Call-Route-Gruppe (POST /api/calls, POST /api/calls/:id/cancel) lebt
// jetzt in src/routes/api-calls.js (makeCallRoutes, DI-Muster wie makeReadRoutes) -
// reine Verschiebung, Verhalten unveraendert. An unveraenderter Mount-Position (nach
// der REST-API-Section, vor makeReadRoutes), hinter Basic-Auth (Bestand deckt /api/* ab).
// INV-9: die Outbound-Gate-Kette (outboundGates = EIN gepinntes Array) + der Max-Dauer-
// Cap (arm.*) + der Fehlerpfad (terminateAndBillCall) wandern unveraendert mit; finishCall
// = die EINE callFinish-Instanz (INV-7), arm.* = die EINE lifecycle-Instanz.
app.use(
  makeCallRoutes({
    store,
    config,
    audit,
    outboundGates,
    voiceControl,
    originateAiAssistantCall,
    terminateAndBillCall,
    hangUpAction,
    billThunk,
    finishCall: callFinish.finishCall,
    arm: {
      armMaxDurationTimer: lifecycle.armMaxDurationTimer,
      armReserveReleaseTimer: lifecycle.armReserveReleaseTimer,
    },
    tenant: { requestTenant, tenantOwnsCall },
    internalIdentity,
    OWNER_ID,
  }),
);

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

// ---- Onboarding-Routen (Server-Slim P10) ----------------------------------------
// /api/onboard + /api/onboard/retry lebt jetzt in src/routes/api-onboard.js
// (makeOnboardRoutes, DI-Muster wie makeBillingRoutes/makeCallRoutes) - reine
// Verschiebung. Unveraenderte Mount-Position (nach makeBillingRoutes, vor /mcp),
// hinter Basic-Auth (Bestand deckt /api/* ab). provisioning = die EINE P6-Instanz
// (INV-7). Der withStoreLock-kritische Abschnitt + Nummern-Caps + persist_error->503
// wandern unveraendert mit.
app.use(makeOnboardRoutes({ store, config, audit, provisioning }));

// ================= MCP ueber Streamable HTTP (Custom Connector) =================
// Das /mcp-Trio (POST mit mcpAuth, GET/DELETE -> 405) lebt jetzt in src/routes/mcp.js
// (makeMcpRoutes, DI-Muster wie makeBillingRoutes/makeVoiceRoutes) - reine Verschiebung,
// Verhalten unveraendert. Mount an UNVERAENDERTER Position: nach makeOnboardRoutes, vor
// errorHandler (INV-2). /mcp ist Auth-Gate-exempt (Gate ruft next() fuer /mcp*, INV-3);
// mcpAuth bleibt die EINZIGE Absicherung auf POST, fail-closed. Stateless pro Request
// (INV-8) + res.on("close")-Cleanup sind ins Modul mitgewandert. requestTenant = die EINE
// Wurzel-Instanz (INV-7).
app.use(makeMcpRoutes({ config, store, requestTenant }));

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

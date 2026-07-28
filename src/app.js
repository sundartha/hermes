// ---- Kompositionswurzel HTTP-Schicht (PLAN-SERVER-SLIM.md) ----------------------
// buildApp(deps) baut die Express-App als EINE sichtbare Middleware-/Mount-Sequenz
// (INV-2) aus benannten Registrar-Funktionen + Router-Factory-Mounts. REINE
// Verschiebung aus server.js (byte-identische Reihenfolge, Semantik, Antworten).
// Laufzeit-Instanzen (config/store/audit + die in server.js konstruierten P1-P6-
// Instanzen) kommen via deps herein; reine Helfer/Factories/Konstanten werden direkt
// importiert (Konvention wie wiring/web-login.js). STRIPE_WEBHOOK_PATH bleibt EINE
// Konstante (INV-1), gespeist an captureRawBody + installAuthGate(paths) +
// wireWebLogin(stripeWebhookPath).
import path from "path";
import express from "express";
import { securityHeaders, createRateLimiter, errorHandler } from "./middleware.js";
import { registerWellKnown } from "./auth.js";
import { PLAN_CATALOG } from "./plans.js";
import { makeTelnyxLlmShim } from "./telnyx-llm-shim.js";
import { agentTurn } from "./claude.js";
import { localeFor } from "./i18n/locales.js";
import { safeEqual } from "./util.js";
import { BRAND_ASSETS_PREFIX } from "./mcp-server-info.js";
import { configFingerprint } from "./config-fingerprint.js";
import {
  voiceControl,
  webhookEvents,
  inboundSignatureVerifier,
  providerFromHeaders,
} from "./telephony/registry.js";
import { terminateAndBillCall, hangUpAction, billThunk } from "./telephony/call-termination.js";
import { originateAiAssistantCall } from "./telnyx-origination.js";
import { stripeBilling } from "./billing/stripe.js";
import { makeVoiceRoutes } from "./routes/voice.js";
import { makeReadRoutes } from "./routes/api-read.js";
import { makeTenantWriteRoutes } from "./routes/api-tenant-write.js";
import { makeProfileRoutes } from "./routes/api-profiles.js";
import { makeBillingRoutes } from "./routes/api-billing.js";
import { makeCallRoutes } from "./routes/api-calls.js";
import { makeOnboardRoutes } from "./routes/api-onboard.js";
import { makeMcpRoutes } from "./routes/mcp.js";
import { wireWebLogin } from "./wiring/web-login.js";
import { makeAuthGate } from "./wiring/auth-gate.js";
import { guardedBoot } from "./boot-guard.js";
import { createPortalRunner } from "./portal-pool.js";
import {
  isTrustedLocalCaller,
  internalIdentity,
  OWNER_ID,
  tenantOwnsCall,
} from "./request-tenant.js";
// P14: App-Shell- und Altpfad als EINE Quelle (src/portal-paths.js) - dieselben
// Konstanten brauchen die Stripe-Rueckkehr-Ziele in self-service-routes.js und
// api-billing.js (Import in die Gegenrichtung waere ein Zyklus).
import { APP_PATH, LEGACY_PORTAL_PATH } from "./portal-paths.js";

// Body-Groesse begrenzen: kein Endpunkt braucht mehr als 100kb (Twilio-Webhooks
// und API-Payloads sind klein) - schuetzt vor Memory-Druck durch Riesen-Bodies.
const BODY_LIMIT = "100kb";
// P5: Ziel des Landing-Redirects (kein Magic-String, G25). "/" hat kein Index ->
// 302 auf den Login (= Registrierung, Strategie R2). Pfad lebt auf dem Gateway
// (makeWebAuthRoutes GET /auth/login), nicht auf der Static Site.
const LOGIN_PATH = "/auth/login";
// W4: Stripe-Webhook-Pfad (kein Magic-String, G25). Die HMAC-Signaturpruefung braucht
// den unveraenderten Roh-Body -> wird zusaetzlich zu /voice erfasst (s. captureRawBody).
const STRIPE_WEBHOOK_PATH = "/webhooks/stripe";
// /voice-Praefix als EINE Quelle (G5): Basic-Auth-Exemption (auth-gate), rawBody-Capture
// und der Rate-Limit-Bypass teilen denselben Praefix.
const VOICE_PATH_PREFIX = "/voice";
// rawBody fuer /voice (Twilio/Telnyx) UND den Stripe-Webhook erfassen: beide pruefen
// gegen den unveraenderten Body. Der Twilio-HMAC nutzt weiterhin nur die geparsten
// Params - die Erfassung aendert das Parsen NICHT (verify laeuft VOR dem Parsen, additiv).
const captureRawBody = (req, _res, buf) => {
  if (req.path.startsWith(VOICE_PATH_PREFIX) || req.path === STRIPE_WEBHOOK_PATH) req.rawBody = buf;
};

export function installGlobalMiddleware({ app, config }) {
  app.use(securityHeaders);

  // ---- Rate-Limit fuer alle Nicht-Twilio-Routen (vor Auth: bremst auch Brute-Force).
  // /voice/* ist ausgenommen (kommt von Twilio, eigene Signaturpruefung), ebenso
  // vertrauenswuerdige lokale In-Process-Aufrufe (interne MCP-Tools): echtes Loopback OHNE
  // Proxy-Weiterleitung. NICHT per isLocalSocket allein - hinter Render erscheint auch
  // externer Traffic als Loopback (-> sonst liefe das Limit fuer den ganzen Internet-
  // Traffic ins Leere). isTrustedLocalCaller verlangt zusaetzlich kein X-Forwarded-For.
  const rateLimiter = createRateLimiter(config.safety.rateLimitPerMin);
  app.use((req, res, next) => {
    if (req.path.startsWith(VOICE_PATH_PREFIX) || isTrustedLocalCaller(req)) return next();
    rateLimiter(req, res, next);
  });

  app.use(express.urlencoded({ extended: false, limit: BODY_LIMIT, verify: captureRawBody })); // Twilio-Webhooks
  app.use(express.json({ limit: BODY_LIMIT, verify: captureRawBody })); // eigene API + MCP

  // Body-Parser-Fehler (413 zu gross, 400 kaputtes JSON) als JSON statt HTML beantworten
  app.use((err, _req, res, next) => {
    if (!err.status || err.status < 400 || err.status >= 500) return next(err);
    res.status(err.status).json({ error: err.type || "bad request" });
  });
}

export function registerPublicRoutes({ app, config, store, watchdog }) {
  // ---- Basic-Auth fuer Dashboard + API (Public Hosting). Ausgenommen:
  // /voice/* (eigene Twilio-Signaturpruefung), /mcp (eigene MCP-Auth),
  // /.well-known/* (OAuth-Metadata, muss ohne Login erreichbar sein),
  // /healthz (Keep-Alive) und vertrauenswuerdige lokale In-Process-Aufrufe (interne
  // MCP-Tools, isTrustedLocalCaller - NICHT per Socket-Adresse allein, s.u.).
  // GAP-36 (Deploy-Wahrheit): der EINE Ort, an dem der laufende Dienst selbst sagt,
  // welchen Commit und welche Konfiguration er faehrt (Post-Deploy-Smoke +
  // Rollback-Drill). AUTH-AUSNAHME bleibt unveraendert (Keep-Alive) - deshalb NUR
  // Git-SHA + Einweg-Hash, NIE ein Rohwert oder Secret (Begruendung in
  // src/config-fingerprint.js). Pro Request neu gerechnet: sha256 ueber ~40 Byte ist
  // vernachlaessigbar, der Endpunkt liegt hinter dem Rate-Limiter, und ein gecachter
  // Wert waere ein Lazy-Init-Antipattern (P15) mit Staleness-Risiko.
  app.get("/healthz", (_req, res) =>
    res.json({ ok: true, commit: config.server.deployedCommit, configHash: configFingerprint(config) }),
  );

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
  // Kosten-Notaus: EIN ConversationWatchdog, geteilt von Shim (Loop-Guard +
  // Dead-Air-Feed pro Turn) und Call-Control-Ingest (Dead-Air armieren bei ai_assistant_start,
  // stoppen bei hangup). Terminierung ueber das GETEILTE Call-Control-Hangup-Primitiv (auch
  // der Shim nutzt makeCallControlTerminator fuer Budget-Kill/end_call, S2). watchdog kommt
  // als die EINE Wurzel-Instanz herein (INV-7, in server.js konstruiert).
  app.post("/v1/chat/completions", makeTelnyxLlmShim({ store, config, agentTurn, localeFor, voiceControl, watchdog }));

  // P5: "/" hat kein Index (public/ traegt nur statische Marken-Assets) -> ginge sonst auf 404 bzw. die
  // Owner-Basic-Auth-Sackgasse. 302 auf den Login (= Registrierung, Strategie R2). VOR der
  // Basic-Auth + express.static gemountet wie /auth/*; traegt keine Tenant-Daten, braucht
  // keine Session - daher unkonditional (greift auch ohne Web-Login-Infra).
  // Single-Origin (P1): mit WEB_DIST_DIR faellt "/" bewusst durch auf die statische
  // Marketing-index.html (dist/index.html, weiter unten gemountet) -> der Landing-Redirect
  // gilt nur OHNE den unified Build (byte-identisch zum Bestand).
  if (!config.server.webDistDir) {
    app.get("/", (_req, res) => res.redirect(302, LOGIN_PATH));
  }
}

export function registerStaticServing({ app, config }) {
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
  if (config.server.webDistDir) {
    // Altpfad /tenant.html -> /app. Die Datei public/tenant.html ist mit P14 geloescht;
    // dieser Redirect bleibt trotzdem, und zwar NICHT nur wegen Bookmarks: eine Stripe-
    // Checkout-Session, die VOR dem Deploy geoeffnet wurde, traegt die alte Rueckkehr-
    // Adresse in der Stripe-Session - ohne den Redirect landet genau der Kunde, der
    // gerade bezahlt hat, auf einem 404. P2/D2: den Query-String ERHALTEN, sonst saehe
    // die BillingIsland (?card/?sub-Handler) den Parameter nie. Nur den Such-Teil
    // anhaengen (kein Query -> reines /app).
    app.get(LEGACY_PORTAL_PATH, (req, res) => {
      const queryAt = req.originalUrl.indexOf("?");
      const search = queryAt === -1 ? "" : req.originalUrl.slice(queryAt);
      res.redirect(302, APP_PATH + search);
    });
    // Statische Marketing-Site + App-Shell. extensions:["html"] loest /preise -> preise.html
    // auf; "/" liefert dist/index.html, /app -> app/index.html (express.static-Index-Default).
    app.use(express.static(config.server.webDistDir, { extensions: ["html"] }));
    // SPA-Fallback: Unterpfade unter /app liefern die App-Shell (Client-seitiges Routing).
    app.get("/app/*", (_req, res) => res.sendFile(path.join(config.server.webDistDir, "app", "index.html")));
  }
}

export function installAuthGate({ app, config, audit }) {
  // ---- Basic-Auth-Gate ---------------------------------------------------------------
  // Kern-Safety-Naht: Gate + gesamte Exemption-Liste leben in src/wiring/auth-gate.js
  // (makeAuthGate). Mount an UNVERAENDERTER Position (nach der WEB_DIST_DIR-Static-
  // Schicht, VOR express.static(publicDir) in buildApp, INV-2); Exemption-Reihenfolge
  // eingefroren (INV-3, auth-gate-exemption-order.test.js). Alle Voice-/API-/MCP-Router
  // bleiben HINTER dem Gate. STRIPE_WEBHOOK_PATH bleibt EINE Quelle (INV-1).
  app.use(
    makeAuthGate({
      config,
      audit,
      isTrustedLocalCaller,
      safeEqual,
      BRAND_ASSETS_PREFIX,
      VOICE_PATH_PREFIX,
      paths: { STRIPE_WEBHOOK_PATH },
    }),
  );
}

export async function buildApp(deps) {
  const {
    config,
    store,
    audit,
    callFinish,
    lifecycle,
    provisioning,
    outboundGates,
    requestTenant,
    requireTenant,
    conversationWatchdog,
    ttsStore,
    directiveSynth,
    voiceRender,
    costTruing,
    messaging,
  } = deps;

  const app = express();
  // Genau EIN vertrauenswuerdiger Proxy (Render). Nicht `true`: sonst kann jeder Client
  // per X-Forwarded-For eine beliebige IP vortaeuschen.
  app.set("trust proxy", 1);

  installGlobalMiddleware({ app, config });
  registerPublicRoutes({ app, config, store, watchdog: conversationWatchdog });

  // ---- OIDC-Browser-Login (/auth/*) -----------------------------------
  // Nur aktiv wenn sessionSecret UND pg-Backend gesetzt: ohne DB kein Session-Store,
  // ohne Secret keine Cookie-Signatur. Muss VOR Basic-Auth und express.static liegen,
  // damit /auth/login nicht durch Basic-Auth geblockt wird.
  if (config.auth.sessionSecret && config.store.storeBackend === "pg") {
    // INV-11: der gesamte Web-Login/Portal/Stripe-Webhook/Self-Service-Block (in
    // src/wiring/web-login.js, wireWebLogin) laeuft in guardedBoot (fail-OPEN). Wirft
    // createPortalRunner (F5-Rollen-Assertion ODER Portal-DB unerreichbar) oder ein
    // Wiring-Schritt, faengt guardedBoot es laut + secret-frei ab -> Routen NICHT gemountet
    // (404), aber /voice, /healthz, /mcp und das Owner-Dashboard leben weiter. Q1: wireWebLogin
    // loggt im Erfolgsfall "[boot] Web-Login aktiv" (eigene Zeile), sodass der fail-open-
    // Zustand nicht mehr unsichtbar ist. createPortalRunner injiziert (DIP-Seam, offline
    // fakebar); STRIPE_WEBHOOK_PATH/APP_PATH bleiben EINE Konstante
    // (INV-1) und werden hereingereicht. provision = provisioning.triggerTenantProvisioning
    // (die EINE P6-Orchestrator-Instanz, in server.js konstruiert, TDZ-Vermeidung).
    await guardedBoot("Web-Login/Portal", () =>
      wireWebLogin({
        app,
        config,
        store,
        audit,
        provision: provisioning.triggerTenantProvisioning,
        createPortalRunner,
        stripeWebhookPath: STRIPE_WEBHOOK_PATH,
        appPath: APP_PATH,
        messaging,
      }),
    );
  }

  registerStaticServing({ app, config });
  installAuthGate({ app, config, audit });
  app.use(express.static(config.server.publicDir));

  // Play-TTS-Seam, Voice-Render-Helfer und Directiven-Synth kommen als die EINEN
  // Wurzel-Instanzen herein (INV-7, in server.js konstruiert).

  // ---- Voice-Webhooks -----------------------------------------------------------------
  // Alle /voice/* (GET /voice/tts/:token, app.use("/voice",sig-MW), incoming/turn/outbound/
  // status/call-control) leben in routes/voice.js (makeVoiceRoutes, DI-Muster wie
  // makeCallRoutes). Mount an UNVERAENDERTER Position: nach express.static(publicDir), vor
  // makeCallRoutes (INV-2). /voice ist Auth-Gate-exempt (Sig fail-closed). INV-4: TTS-Route
  // VOR der Sig-MW (im Router festgehalten). finishCall = die EINE callFinish-Instanz
  // (INV-7); watchdog = der EINE conversationWatchdog (geteilt mit dem Shim);
  // voiceRender/directiveSynth/ttsStore/lifecycle = die EINEN Wurzel-Instanzen.
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

  // ---- Outbound-Call-Routen -------------------------------------------------------
  // Die Outbound-Call-Route-Gruppe (POST /api/calls, POST /api/calls/:id/cancel) lebt
  // in src/routes/api-calls.js (makeCallRoutes, DI-Muster wie makeReadRoutes) - reine
  // Verschiebung, Verhalten unveraendert. An unveraenderter Mount-Position (nach
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
  // /api/tenant-data/export) lebt in src/routes/api-read.js (makeReadRoutes,
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

  // ---- Tenant-Write-Routen ---------------------------------------------------------
  // Die tenant-scoped Schreib-Route-Gruppe (POST /api/settings,
  // POST /api/action-items/:id/toggle, POST /api/calendar) lebt in
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
  // Die /api/profiles-Route-Gruppe lebt in
  // src/routes/api-profiles.js (makeProfileRoutes, DI-Muster wie makeWebAuthRoutes) -
  // reine Verschiebung, Verhalten unveraendert. validIdentity wird von dort importiert
  // (eine Quelle, G5) und in /api/onboard weiterverwendet.
  // Hinter Basic-Auth (Bestand deckt /api/* ab); KEIN MCP-Tool (s. Modul-Kommentar).
  app.use(makeProfileRoutes({ store, audit }));

  // ---- Billing-Routen ---------------------------------------------------------------
  // Die /api/billing/*-Route-Gruppe (flush-meters, setup-checkout, checkout-return,
  // cost-truing/sweep) lebt in src/routes/api-billing.js (makeBillingRoutes, DI-Muster
  // wie makeReadRoutes) - reine Verschiebung, Verhalten unveraendert. An unveraenderter
  // Mount-Position (nach makeProfileRoutes, vor /api/onboard), hinter Basic-Auth
  // (Bestand deckt /api/* ab). billing = stripeBilling (EINE Instanz, INV-7);
  // requireTenant = die EINE Wurzel-Instanz (403 bei TENANT_REJECT). costTruing = die
  // EINE LCT-P3-Instanz (INV-7, in server.js konstruiert). Der Safety-Kontext (kein
  // MCP-Tool, PAYMENT_ENABLED-404-Gate) ist ins Modul mitgewandert.
  app.use(
    makeBillingRoutes({
      config,
      store,
      audit,
      billing: stripeBilling,
      tenant: { requireTenant },
      costTruing,
    }),
  );

  // ---- Onboarding-Routen ------------------------------------------------------------
  // /api/onboard + /api/onboard/retry lebt in src/routes/api-onboard.js
  // (makeOnboardRoutes, DI-Muster wie makeBillingRoutes/makeCallRoutes) - reine
  // Verschiebung. Unveraenderte Mount-Position (nach makeBillingRoutes, vor /mcp),
  // hinter Basic-Auth (Bestand deckt /api/* ab). provisioning = die EINE P6-Instanz
  // (INV-7). Der withStoreLock-kritische Abschnitt + Nummern-Caps + persist_error->503
  // wandern unveraendert mit.
  app.use(makeOnboardRoutes({ store, config, audit, provisioning }));

  // ================= MCP ueber Streamable HTTP (Custom Connector) =================
  // Das /mcp-Trio (POST mit mcpAuth, GET/DELETE -> 405) lebt in src/routes/mcp.js
  // (makeMcpRoutes, DI-Muster wie makeBillingRoutes/makeVoiceRoutes) - reine Verschiebung,
  // Verhalten unveraendert. Mount an UNVERAENDERTER Position: nach makeOnboardRoutes, vor
  // errorHandler (INV-2). /mcp ist Auth-Gate-exempt (Gate ruft next() fuer /mcp*, INV-3);
  // mcpAuth bleibt die EINZIGE Absicherung auf POST, fail-closed. Stateless pro Request
  // (INV-8) + res.on("close")-Cleanup sind ins Modul mitgewandert. requestTenant = die EINE
  // Wurzel-Instanz (INV-7).
  app.use(makeMcpRoutes({ config, store, requestTenant }));

  // ---- Catch-all Error-Net -----------------------------------------------------------
  // MUSS NACH allen Route-Mounts und VOR app.listen stehen: Express-Error-MW sieht nur
  // Fehler von davor gemounteten Routen. Last-Resort-Netz fuer synchron geworfene/per
  // next(err) gereichte Routen-Fehler -> generische 500, NIE err.message/stack/Env an den
  // Client (Regel 4/5); err.stack nur server-seitig laut geloggt. Die per-Route-try/catch
  // (z.B. /auth/login, /voice/turn) bleiben die primaere Schicht (Express 4 reicht
  // async-Rejections NICHT automatisch hierher). Die body-parser-Error-MW (oben, 4xx
  // Parser-Fehler) bleibt unveraendert an ihrer Stelle.
  app.use(errorHandler);

  return { app };
}

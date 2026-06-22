// Voice-Gateway: Twilio-Webhooks (Inbound/Outbound), Audio-Bridge (Realtime),
// MCP ueber Streamable HTTP (/mcp), REST-API fuer Dashboard & stdio-MCP.
// MUSS erste Importzeile bleiben (vor store.js) - globales Crash-Netz, ESM-Eval-Order (T-P0-07).
import "./process-guards.js";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config, assertConfig } from "./config.js";
import * as store from "./store.js";
import { OWNER_TENANT_ID, DEFAULT_PROVIDER, PROVIDER, NUMBER_STATUS, PROVISION_NUMBER_JOB, PROVISIONING_JOB_STATUS, USAGE_EVENT_KIND, KYC_OUTBOUND_MIN, normNum } from "./store/defaults.js";
import { findActiveNumber } from "./store/views.js";
import { agentTurn, summarizeCall, openingText } from "./claude.js";
import { LlmUnavailableError } from "./llm.js";
import { registerTools } from "./mcp-tools.js";
import { attachMediaBridge, MEDIA_PATH } from "./bridge.js";
import { createRateLimiter, securityHeaders, errorHandler } from "./middleware.js";
import { mcpAuth, registerWellKnown } from "./auth.js";
import { audit, safeEqual } from "./util.js";
import { voiceControl, messaging, voiceRenderer, inboundSignatureVerifier, providerFromHeaders, numberProvisioning } from "./telephony/registry.js";
import { say as sayD, gather as gatherD, hangup as hangupD, redirect as redirectD, stream as streamD } from "./telephony/directives.js";
import { localeFor, languageForCountry } from "./i18n/locales.js";
import { parseSpeakEvent, SPEAK_OUTCOME } from "./telephony/adapters/telnyx/speak-events.js";
import { registerTenant, requestNumber, recordProvisioningJob, markProvisioningJob, setTenantGeo, findNumber } from "./store/state-ops.js";
import { searchParamsForCountry } from "./telephony/provisioning-geo.js";
import { geoLookupAdapter } from "./geo/registry.js";
import { resolveOnboardCountry } from "./geo/resolve.js";
import { handleProvisionJob } from "./worker/provisioning.js";
import { createQueue } from "./queue/registry.js";
import { stripeBilling } from "./billing/stripe.js";
import { flushMeters } from "./billing/meter.js";
import { ensureCustomer, bindCardFromSession } from "./billing/card-setup.js";
import { E164, invalidText } from "./routes/_validation.js";
import { makeReadRoutes } from "./routes/api-read.js";
import { makeSelfServiceRoutes } from "./self-service-routes.js";
import { makeProfileRoutes, validIdentity } from "./routes/api-profiles.js";
import { makeWebAuthRoutes, makeAdminRoutes, makeOidc, makeAccounts, makeSessions, webAuth, adminOnly } from "./web-auth.js";
import { makePortalStore } from "./store/portal.js";
import { makeAuditStore } from "./audit-store.js";
import { createPortalRunner } from "./portal-pool.js";
import { guardedBoot } from "./boot-guard.js";
import { makeRequestTenant, isLocalSocket, internalIdentity, OWNER_ID, ANON_IDENTITY, TENANT_REJECT } from "./request-tenant.js";

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
// nie Owner). Volle Begruendung im Modul-Doc von request-tenant.js. isLocalSocket/
// internalIdentity sowie OWNER_ID/ANON_IDENTITY/TENANT_REJECT kommen aus demselben
// Modul (oben importiert).
const { requestTenant, requireTenant } = makeRequestTenant(store);

app.use(securityHeaders);

// ---- Rate-Limit fuer alle Nicht-Twilio-Routen (vor Auth: bremst auch Brute-Force).
// /voice/* ist ausgenommen (kommt von Twilio, eigene Signaturpruefung), ebenso
// localhost-Sockets (interne MCP-Tools, Dashboard-Entwicklung).
const rateLimiter = createRateLimiter(config.rateLimitPerMin);
app.use((req, res, next) => {
  if (req.path.startsWith("/voice") || isLocalSocket(req)) return next();
  rateLimiter(req, res, next);
});

// Body-Groesse begrenzen: kein Endpunkt braucht mehr als 100kb (Twilio-Webhooks
// und API-Payloads sind klein) - schuetzt vor Memory-Druck durch Riesen-Bodies.
const BODY_LIMIT = "100kb";
// rawBody nur fuer /voice erfassen (kuenftiger Ed25519-Pfad/Telnyx braucht den
// unveraenderten Body). Der Twilio-HMAC nutzt weiterhin nur die geparsten Params -
// die Erfassung aendert das Parsen NICHT (verify laeuft VOR dem Parsen, additiv).
const captureRawBody = (req, _res, buf) => {
  if (req.path.startsWith("/voice")) req.rawBody = buf;
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
// /healthz (Keep-Alive) und localhost (interne MCP-Tools).
app.get("/healthz", (_req, res) => res.json({ ok: true }));
registerWellKnown(app);

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
    const adminMw = adminOnly({ adminEmails: config.adminEmails });
    const loginRateLimiter = createRateLimiter(config.loginRateLimitPerMin);
    app.use("/auth", loginRateLimiter);
    app.use(makeWebAuthRoutes({
      secret: config.sessionSecret,
      redirectUri: config.publicUrl + "/auth/callback",
      ttlSeconds: config.sessionTtlSeconds,
      oidc,
      accounts,
      sessions,
      audit: auditStore,
    }));

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
      app.use(makeSelfServiceRoutes({ store, webAuthMw, audit, config, billing: stripeBilling }));
    }
  });
}

app.use((req, res, next) => {
  if (!config.dashboardPassword) return next();
  // Self-Service-Seite (I9 + #3) ist die GETRENNTE Tenant-Sicht: NICHT hinter der
  // Admin-Basic-Auth. Nur die statische HTML-Seite ist frei - sie enthaelt KEINE
  // Tenant-Daten (die kommen ueber /api/self-service/*, abgesichert per webAuthMw +
  // Session-Cookie aus dem OIDC-Browser-Login, nicht mehr per Bearer-Paste).
  // Hinter den Flags (Self-Service + MULTI_TENANT): aus -> nicht ausgenommen ->
  // byte-identisch zum Bestand.
  if (config.selfServiceEnabled && config.multiTenant && req.path === "/tenant.html") return next();
  if (req.path.startsWith("/voice") || req.path.startsWith("/mcp") ||
      req.path.startsWith("/.well-known") || req.path === "/healthz") return next();
  if (isLocalSocket(req)) return next();
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
// Turn-Posts (2026-06-20, [turn-recv]) aber `SpeechResult` (und KEIN `Transcript`) -
// daher defensiv BEIDE lesen, damit der Agent den erkannten Text nutzt, egal in welchem
// Feld Telnyx ihn liefert (sonst hoert der Agent trotz korrekter STT nichts -> Stille).
function extractSpeech(req, provider) {
  if (provider === "telnyx") return (req.body.Transcript || req.body.SpeechResult || "").trim();
  return (req.body.SpeechResult || "").trim();
}

// Provider-bewusstes Auslesen des Call-Lifecycle-Status aus dem StatusCallback-Body
// (analog extractSpeech). Beide Provider senden PascalCase-Felder (CallStatus,
// CallDuration) als form-encoded POST. Telnyx liefert zusaetzlich CallDuration
// (Sekunden) als Diagnose; Twilio nicht -> diagnostics bleibt fuer Twilio leer
// (byte-identisch zum Bestand). diagnostics ist bewusst PII-frei (nur Zahlen, NIE
// From/To/Nummern). Garbage/fehlende CallDuration -> kein Diagnose-Feld (kein NaN).
function extractLifecycleEvent(req, provider) {
  const status = req.body.CallStatus;
  if (provider !== PROVIDER.TELNYX) return { status, diagnostics: {} };
  const durationS = parseInt(req.body.CallDuration, 10);
  const diagnostics = Number.isFinite(durationS) ? { callDurationS: durationS } : {};
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
// -> Allowlist (Bestand, LETZTES Gate, bleibt scharf). Die Denylist laeuft BEWUSST
// vor der Formatpruefung: so erscheint eine Notruf-Kurzwahl (112) als bewusste
// Sperre (403 denylist) und nicht als Formatfehler (400).
//
// Rechteprofile (Phase 2): das Profil kann das Land-Gate NUR weiter einschraenken
// (Schnittmenge global ∩ profil), das Stundenlimit NUR senken (min global/profil)
// und die Allowlist lockern (unrestricted/eigene Liste). Denylist, Land-Obergrenze,
// globales Stundenlimit, Budget und Max-Dauer bleiben harte globale Obergrenzen.
//
// Hardcoded (kein Env, nicht abschaltbar): Notruf-Kurzwahlen exakt (sonst wuerde
// "112" auch legitime Nummern als Prefix treffen), Premium-/Service-Prefixe per
// startsWith. Eng gefasst, damit normale Mobilnummern (+4915...) durchkommen.
const EMERGENCY_SHORT_CODES = ["110", "112", "911", "999"];
const PREMIUM_PREFIXES = ["+49900", "+49137", "+49180", "+49118", "+870", "+881", "+882", "+883", "+979"];
const HOUR_MS = 60 * 60 * 1000;

const isDenied = (to) => EMERGENCY_SHORT_CODES.includes(to) || PREMIUM_PREFIXES.some((p) => to.startsWith(p));
const matchesPrefix = (to, codes) => codes.includes("*") || codes.some((c) => to.startsWith(c));

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
const globalHourReached = () => store.countOutboundCallsSince(hourWindowStart()) >= config.maxCallsPerHour;
// Pro-Nutzer-Stundenlimit: effektiv min(global, profil) - ein Profil kann nur senken.
function userHourReached(profile, requestedBy) {
  const limit =
    profile.maxCallsPerHour == null
      ? config.maxCallsPerHour
      : Math.min(config.maxCallsPerHour, profile.maxCallsPerHour);
  return store.countOutboundCallsSince(hourWindowStart(), { requestedBy }) >= limit;
}

// Allowlist (letztes Gate): profil.unrestricted ODER eine Nummer in der eigenen
// Profil-Allowlist heben die globale Allowlist auf - sonst gilt sie unveraendert
// (Bestand). Hebt NUR die Allowlist auf, alle Gates davor liefen schon.
function allowlistError(to, profile) {
  if (profile.unrestricted) return null;
  if (profile.allowedNumbers?.includes(to)) return null;
  if (!config.allowedNumbers.length)
    return { status: 403, grund: "allowlist", message: "Allowlist ist leer (ALLOWED_NUMBERS in .env). Outbound-Anrufe sind gesperrt." };
  if (!config.allowedNumbers.includes(to))
    return { status: 403, grund: "allowlist", message: `Nummer ${to} steht nicht in der Allowlist (ALLOWED_NUMBERS). Anruf verweigert.` };
  return null;
}

// KYC-Gate (P6b4): vor dem ersten Outbound muss der Tenant mindestens KYC_OUTBOUND_MIN
// (card) erreicht haben. fail-closed Schnittmenge - ergaenzt die Outbound-Gate-Kette,
// lockert NIE ein bestehendes Gate. Owner/Bestand (kein kyc_level) -> store.kycReached
// liefert true -> byte-identisch. Liefert {status,grund,message} (Gate-Vertrag) oder null.
function kycGateError(tenantId) {
  if (store.kycReached(tenantId, KYC_OUTBOUND_MIN)) return null;
  return { status: 403, grund: "kyc", message: "Verifikation unzureichend (KYC) fuer Outbound-Anrufe. Bitte Identitaet bestaetigen." };
}

// Liefert {status, grund, message} fuer das erste verletzte Gate, sonst null.
// profile/requestedBy steuern Land-Schnittmenge, pro-Nutzer-Limit und Allowlist.
function numberGateError(to, profile, requestedBy) {
  if (isDenied(to))
    return { status: 403, grund: "denylist", message: `Nummer ${to} ist gesperrt (Notruf-/Premium-/Service-Nummer). Anruf verweigert.` };
  if (!E164.test(to))
    return { status: 400, grund: "format", message: "to muss E.164 sein, z.B. +4917212345678" };
  if (!countryGateAllowed(to, profile))
    return { status: 403, grund: "land", message: `Laendervorwahl von ${to} ist nicht erlaubt (ALLOWED_COUNTRY_CODES). Anruf verweigert.` };
  if (globalHourReached())
    return { status: 429, grund: "stundenlimit", message: `Stundenlimit fuer Outbound-Anrufe erreicht (MAX_CALLS_PER_HOUR=${config.maxCallsPerHour}). Bitte spaeter erneut.` };
  if (userHourReached(profile, requestedBy))
    return { status: 429, grund: "stundenlimit_nutzer", message: "Persoenliches Stundenlimit fuer Outbound-Anrufe erreicht. Bitte spaeter erneut." };
  return allowlistError(to, profile);
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
  return [streamD({
    url,
    params: [
      { name: "call_id", value: call.id },
      { name: "stream_token", value: call.streamToken },
    ],
  })];
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
      voiceControl(c.provider).endCall(providerCallSid).catch(() => {});
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
    return res.type("text/xml").send(render([
      sayD("Diese Nummer ist nicht erreichbar. Auf Wiederhoeren."),
      hangupD(),
    ], provider));
  }
  const tenantId = numberRecord.tenantId;
  // Aufloesungs-Praezedenz (#8): settings.language -> number.language ->
  // tenant.defaultLanguage -> "de". Hier liegt der Geo-Anker der angerufenen Nummer vor.
  const language = store.resolveCallLanguage({ tenantId, numberRecord });
  const locale = localeFor(language);

  // Schnittmenge (R2): pro-Tenant-Budget UND globaler Plattform-Notaus muessen
  // frei sein. Fuer owner-only fallen beide zusammen -> byte-identisch zum Bestand.
  if (store.budgetExceeded(tenantId, config) || store.globalBudgetExceeded(config)) {
    return res.type("text/xml").send(render([
      sayD(locale.budgetExhaustedHangup, locale.voiceProfile),
      hangupD(),
    ], provider));
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
  // TEMP-DIAGNOSE (STT-Live-Abschluss, siehe STATUS.md Abschnitt 2): VOR dem Guard, damit
  // auch ein fehlender callId sichtbar wird (die relative action-URL `?callId=` verliert
  // bei Telnyx evtl. den Query-String -> frueher Hangup, ohne dass der Turn laeuft).
  // Nur Feld-NAMEN + Wert-LAENGEN, nie Roh-Werte (DSGVO/PII). Phase 3: wieder entfernen.
  console.log("[turn-recv]",
    "callId=" + (req.query.callId || "FEHLT"),
    "fields=" + Object.entries(req.body || {}).map(([k, v]) => `${k}:${String(v).length}`).join(","));

  const call = store.getCall(req.query.callId);
  if (!call || call.status !== "active") {
    console.log("[turn-recv] -> frueher Hangup: Call fehlt/inaktiv (callId nicht aufloesbar)");
    return res.type("text/xml").send(render([hangupD()]));
  }

  const heard = extractSpeech(req, call.provider);
  try {
    if (!heard && call.transcript.some((t) => t.role === "caller")) {
      return res.type("text/xml").send(render(
        followupTurnDirectives(call, localeFor(call.language).noSpeechReprompt),
        call.provider
      ));
    }
    const { speech, endCall } = await agentTurn(call, heard || null);
    // TEMP-DIAGNOSE (Turn-Erfolgspfad, Gegenstueck zu [turn-recv]): belegt, dass das LLM
    // antwortet und der Agent seinen Anlass nennt (nur Laengen, nie Roh-Text/PII).
    // Phase 3: zusammen mit [turn-recv] wieder entfernen.
    console.log("[turn-ok]",
      "heard=" + (heard ? heard.length : 0),
      "reply=" + (speech ? speech.length : 0),
      "endCall=" + !!endCall);
    const directives = endCall ? [sayInCallVoice(call, speech), hangupD()] : followupTurnDirectives(call, speech);
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
    const speech = err instanceof LlmUnavailableError ? locale.llmDegradedSpeech : locale.turnErrorSpeech;
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

// Sekunden pro abgerechneter Voice-Minute (G25). Abgerechnet wird ab answeredAt
// (vorher klingelt es nur, keine Gespraechszeit) bis endedAt, aufgerundet (Provider-
// Minutentakt). Ein nie beantworteter Call (kein answeredAt) hat 0 Minuten.
const MS_PER_MINUTE = 60 * 1000;

// Voice-Minuten-Meter EINES beendeten Calls (P6b3, Meter 2). NUR im Metering-Pfad
// (PAYMENT_ENABLED, vom Aufrufer gegated) - der Nebeneffekt (recordUsageEvent) steht
// im Namen. Nicht beantwortet -> 0 Minuten -> kein Event (kein Null-Beleg). Kosten-
// Cents aus dem benannten Tarif (config.voiceMinuteCostCents x Minuten). callId
// verknuepft den Beleg, ueberlebt aber ein Call-Erase (usage_event ohne call-FK).
function recordVoiceMinuteMeter(call) {
  if (!call.answeredAt || !call.endedAt) return;
  const minutes = Math.ceil((new Date(call.endedAt) - new Date(call.answeredAt)) / MS_PER_MINUTE);
  if (minutes <= 0) return;
  store.recordUsageEvent({
    tenantId: call.tenantId,
    callId: call.id,
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: minutes,
    costCents: minutes * config.voiceMinuteCostCents,
  });
}

// number_month-Meter EINER neu aktivierten Nummer (P6b3, Meter 1). NUR im Metering-
// Pfad (PAYMENT_ENABLED, vom Aufrufer gegated) - der Nebeneffekt steht im Namen.
// number ist undefined, wenn der Job uebersprungen wurde (Re-Drain) -> kein Event.
// callId bewusst null (Nummern-Meter hat keinen Call). costCents = der Setup-Tarif.
function recordNumberMonthMeter(number) {
  if (!number) return;
  store.recordUsageEvent({
    tenantId: number.tenantId,
    kind: USAGE_EVENT_KIND.NUMBER_MONTH,
    quantity: 1,
    costCents: config.numberSetupFeeCents,
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
  store.save();

  if (call.status !== "completed" || !call.transcript.length) {
    store.addNotification(
      call.status === "cancelled" ? "Anruf abgebrochen" : "Anruf nicht zustande gekommen",
      `${call.direction === "outbound" ? call.to : call.from} (Status: ${call.status})`,
      call.id
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

    // SMS-Absender = die aktive Nummer des Call-Tenants AUF DEMSELBEN Provider wie der
    // Call (kein config-Sonderzweig mehr). Keine passende Nummer im Store -> kein
    // Absender -> SMS-Summary still ueberspringen statt mit leerem from zu senden.
    const smsFrom = findActiveNumber(store.load(), call.tenantId, call.provider);
    if (config.sendSmsSummary && config.ownerNumber && smsFrom) {
      const sms =
        `[${store.tenantContext(call.tenantId).settings.agentName}] ${who}\n\n${result.summary}` +
        (aiCount ? `\n\nAction Items:\n` + result.actionItems.map((a, i) => `${i + 1}. ${a}`).join("\n") : "");
      try {
        await messaging(call.provider).sendSms({
          from: smsFrom.e164,
          to: config.ownerNumber,
          body: sms.slice(0, 1500),
        });
      } catch (e) {
        console.error("[sms]", e.message, "(Trial: Zielnummer verifiziert? SMS-faehige Twilio-Nummer?)");
      }
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
      console.error("[voice/speak]", JSON.stringify({ callId: call.id, provider, outcome: speak.outcome, reason: speak.reason }));
    return;
  }

  const { status: callStatus, diagnostics } = extractLifecycleEvent(req, provider);
  // PII-frei (Pre-Mortem): nur callId/Status/Provider/Diagnose-Zahlen ins Log, NIE
  // From/To/Telefonnummern. Macht Telnyx-Lifecycle-Events + CallDuration sichtbar.
  console.log("[voice/status]", JSON.stringify({ callId: call.id, status: callStatus, provider, diagnostics }));
  if (callStatus === "in-progress" || callStatus === "answered") return void store.markAnswered(call.id);
  if (!["completed", "busy", "no-answer", "failed", "canceled"].includes(callStatus)) return;
  if (call.status === "active") store.endCallRecord(call.id, callStatus === "completed" ? "completed" : "failed");
  finishCall(store.getCall(call.id));
});

// ================= REST-API (Dashboard + MCP-Tools) =================

// Absendernummer + Provider fuer den Outbound EINES Tenants (I7, L4). JEDER Tenant -
// auch der Owner (Tenant Null) - telefoniert NUR unter EIGENER aktiver Nummer (e164 +
// provider aus s.numbers); kein config-Sonderzweig mehr. Keine aktive eigene Nummer
// -> null -> Reject, NIE die Nummer eines anderen Tenants als Fallback (Toll-Fraud-
// Riegel, Pre-Mortem R3).
function outboundFrom(s, tenantId) {
  const own = findActiveNumber(s, tenantId);
  return own ? { fromNumber: own.e164, provider: own.provider } : null;
}

// Outbound-Call starten (Vertrag laut Brief: objective/briefing/constraints/...)
app.post("/api/calls", async (req, res) => {
  const b = req.body || {};
  const to = normNum(b.to);
  const objective = b.objective || b.goal;
  if (!to || !objective) return res.status(400).json({ error: "to und objective sind Pflicht" });

  // Identitaet serverseitig (nur localhost-Header), nie aus dem Body. null = Owner.
  // Profile-Achse (Rechte: resolveProfile/requestedBy) UND Tenant-Achse (requestTenant)
  // PARALLEL aus derselben Identitaet (L4). Flag aus -> requestTenant === OWNER_TENANT_ID
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
  // den Ziel-Gates (Schnittmenge, fail-closed). Owner/Bestand byte-identisch (kycReached
  // true bei fehlendem kyc_level). tenantId ist hier bereits aufgeloest + REJECT abgewiesen.
  const kycErr = kycGateError(tenantId);
  if (kycErr) {
    audit("place_call_denied", req, `to=${to} grund=${kycErr.grund} tenant=${tenantId} requestedBy=${requestedBy}`);
    return res.status(kycErr.status).json({ error: kycErr.message });
  }

  // Identitaets-Gate (G1, Geschwister-Regel zu Regel 2): ohne registrierten
  // Auftraggeber-Namen KEIN Outbound (sonst renderte die Offenlegung "...von .").
  // Fail-closed, NIE in /voice/outbound (Premature-close-Schutz) - hier am Producer.
  // tenantContext zieht ownerName aus dem Tenant (Fallback config.ownerName, der per
  // assertConfig nie leer ist) -> leer nur bei kaputtem Seed/manipuliertem Store.
  const ownerName = store.tenantContext(tenantId).ownerName;
  if (!ownerName) {
    audit("place_call_denied", req, `to=${to} grund=keine_identitaet tenant=${tenantId} requestedBy=${requestedBy}`);
    return res.status(403).json({ error: "Kein registrierter Auftraggeber-Name fuer diesen Tenant." });
  }

  // Nummern-Gates VOR der Freitext-Validierung: gesperrte/ungueltige Ziele zuerst abweisen.
  const gateErr = numberGateError(to, profile, requestedBy);
  if (gateErr) {
    // 400 = Eingabe-/Formatfehler, keine Sicherheits-Ablehnung -> nicht auditieren.
    if (gateErr.status !== 400) audit("place_call_denied", req, `to=${to} grund=${gateErr.grund} requestedBy=${requestedBy}`);
    return res.status(gateErr.status).json({ error: gateErr.message });
  }

  const textErr =
    invalidText("objective", objective) ||
    invalidText("briefing", b.briefing) ||
    invalidText("constraints", b.constraints);
  if (textErr) return res.status(400).json({ error: textErr });

  // Absendernummer + Provider tenant-aware (Toll-Fraud-Riegel R3): JEDER Tenant - auch
  // der Owner (Tenant Null) - telefoniert nur unter EIGENER aktiver Store-Nummer; keine
  // -> Reject, NIE die Nummer eines anderen Tenants als Fallback.
  const outbound = outboundFrom(store.load(), tenantId);
  if (!outbound) {
    audit("place_call_denied", req, `to=${to} grund=keine_tenant_nummer tenant=${tenantId} requestedBy=${requestedBy}`);
    return res.status(403).json({ error: "Kein aktive Absendernummer fuer diesen Tenant." });
  }
  const { fromNumber, provider: outboundProvider } = outbound;

  // Budget-Schnittmenge (R2): pro-Tenant-Budget (requestTenant) UND globaler Notaus
  // (Summe ueber alle Buckets) PARALLEL, beide fail-closed. Der globale Notaus wird
  // NIE entfernt; pro-Tenant schraenkt nur zusaetzlich ein. Owner-only byte-identisch.
  if (store.budgetExceeded(tenantId, config) || store.globalBudgetExceeded(config)) {
    audit("place_call_denied", req, `to=${to} grund=budget tenant=${tenantId}`);
    return res.status(402).json({ error: `Budget-Limit von ${config.maxBudgetEur} EUR erreicht.` });
  }

  const maxDur = Math.min(parseInt(b.max_duration_s || config.maxCallDurationS, 10) || 180, 300);
  // Der /voice/outbound-Webhook rendert dank call.provider (P6a) automatisch TeXML
  // statt TwiML.
  const call = store.createCall({
    direction: "outbound",
    from: fromNumber,
    to,
    goal: objective,
    briefing: b.briefing,
    constraints: b.constraints,
    language: b.language || "de",
    maxDurationS: maxDur,
    requestedBy,
    tenantId,
    provider: outboundProvider,
  });
  audit("place_call", req, `to=${to} call=${call.id} provider=${outboundProvider} requestedBy=${requestedBy}`);

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
    console.error(`[place_call] originate fehlgeschlagen call=${call.id}:`, err?.message || String(err));
    res.status(500).json({
      error: "Anruf konnte nicht gestartet werden.",
      hint: "Twilio-Trial: Die Zielnummer muss unter 'Verified Caller IDs' verifiziert sein.",
    });
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
app.use(makeReadRoutes({ store, config, audit, tenant: { requestTenant, requireTenant, tenantOwnsCall } }));

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
  if (!title || !start || !end) return res.status(400).json({ error: "title, start, end sind Pflicht" });
  const titleErr = invalidText("title", title);
  if (titleErr) return res.status(400).json({ error: titleErr });
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate) || isNaN(endDate))
    return res.status(400).json({ error: "start und end muessen gueltige Datumswerte sein (ISO 8601)" });
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
  if (!config.paymentEnabled) return res.status(404).json({ error: "metering disabled (PAYMENT_ENABLED)" });
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
  if (!config.paymentEnabled) return res.status(404).json({ error: "payment disabled (PAYMENT_ENABLED)" });
  if (!config.publicUrl) return res.status(500).json({ error: "PUBLIC_URL fehlt" }); // kein Leak
  const tenant = requireTenant(req, res); // tenant-gescopt; REJECT -> 403
  if (!tenant) return;

  // Customer idempotent anlegen (geteilte Logik, G5: identisch zum Self-Service-Pfad).
  const customerId = await ensureCustomer({ store, billing: stripeBilling, tenant });
  const successUrl = `${config.publicUrl}/api/billing/checkout-return?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${config.publicUrl}/tenant.html?card=canceled`;
  const { url } = await stripeBilling.createSetupCheckoutSession({ tenantRef: tenant, customerId, successUrl, cancelUrl });
  audit("billing_setup_checkout", req, `tenant=${tenant}`);
  res.json({ url });
});

app.get("/api/billing/checkout-return", async (req, res) => {
  if (!config.paymentEnabled) return res.status(404).json({ error: "payment disabled (PAYMENT_ENABLED)" });
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
  const { tenantId, firstName, lastName } = req.body || {};
  if (!validIdentity(tenantId))
    return res.status(400).json({ error: "tenantId ist Pflicht (nicht leer, ohne Whitespace, <=254 Zeichen)" });

  // F1 Phase 6 - Land/Sprache bei der Registrierung. Praezedenz (fail-safe):
  // User-Wahl (body.country, EXPLIZIT, autoritativ R4) > IP-Geo-VORSCHLAG (lokaler
  // Lookup, nur bei GEO_ENABLED) > config.provisioningCountry > DEFAULT_COUNTRY. Die IP
  // (req.ip, proxy-aware via 'trust proxy') verlaesst den Prozess NIE - der Lookup ist
  // streng lokal. Eine gespoofte IP aendert nichts Autoritatives: ohne User-Wahl ist sie
  // nur ein Vorschlag, mit User-Wahl wird sie ueberstimmt. language wird aus dem Land
  // abgeleitet (eine Quelle: languageForCountry). country/language landen auf Tenant-Geo
  // UND Number-Request (R12). KEIN body.country -> Verhalten byte-identisch (DE/de).
  const proposedCountry = config.geoEnabled ? geoLookup(req.ip)?.country : null;
  const country = resolveOnboardCountry({
    userCountry: req.body?.country,
    proposedCountry,
    fallbackCountry: config.provisioningCountry,
  });
  const language = languageForCountry(country);

  // Store-Mutation + Persistenz im prozess-lokalen kritischen Abschnitt (OT-3 AC2):
  // load -> registerTenant -> setTenantGeo -> requestNumber -> save, kein fremdes await
  // dazwischen. Ein Save-I/O-Fehler wird als behandelter 503 beantwortet (AC4), NIE als
  // unhandled async rejection (die den Request haengen liesse / den Prozess via P0-Netz killte).
  const reqRes = await store
    .withStoreLock(() => {
      const s = store.load();
      registerTenant(s, tenantId, { firstName, lastName });
      setTenantGeo(s, tenantId, { country, defaultLanguage: language });
      const r = requestNumber(s, {
        tenantId,
        provider: PROVIDER.TELNYX,
        country,
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
    return res.status(ONBOARD_REASON_STATUS[reqRes.reason] || 400).json({ error: `Nummer-Anfrage abgelehnt (${reqRes.reason})` });
  }
  const numberId = reqRes.number.id;
  audit("onboard_request", req, `tenant=${tenantId} number=${numberId}`);

  // Dry-Run (Default, fail-closed): kein echter Kauf, Nummer bleibt 'requested'.
  if (!config.provisioningEnabled)
    return res.json({ tenantId, numberId, status: reqRes.number.status, country, language, provisioning: "disabled" });

  // BEWUSSTE VERHALTENS-AENDERUNG (P6b2): das Provisioning ist aus dem HTTP-Request
  // geloest. Wir enqueuen einen Job, persistieren die Job-Spur ('requested' + queued)
  // und antworten SOFORT mit 'queued'; ein deterministischer Drain (In-Memory-Queue)
  // fuehrt provisionNumber asynchron aus. Die Geld-Sicherheits-Invarianten (Hold-vor-
  // Order, kein active ohne Capture, Rollback) bleiben in provisionNumber - jetzt im Worker.
  const idempotencyKey = `provision_${numberId}`;
  provisioningQueue.enqueue({ kind: PROVISION_NUMBER_JOB, payload: { numberId }, idempotencyKey });
  // Job-Spur ebenfalls im kritischen Abschnitt persistieren; Save-Fehler -> 503 (AC4).
  const jobRes = await store
    .withStoreLock(() => {
      const s = store.load();
      const job = recordProvisioningJob(s, { numberId, tenantId, idempotencyKey });
      store.save();
      return { ok: true, job };
    })
    .catch((e) => {
      console.error("[onboard] Persistenz (Job-Spur) fehlgeschlagen:", e.message);
      return { ok: false };
    });
  if (!jobRes.ok)
    return res.status(503).json({ error: "Persistenz fehlgeschlagen" });
  audit("onboard_queued", req, `tenant=${tenantId} number=${numberId} job=${jobRes.job.id}`);
  res.json({ tenantId, numberId, status: reqRes.number.status, country, language, provisioning: "queued", jobId: jobRes.job.id });

  // Drain NACH der Response (fire-and-forget): kein echtes Hintergrund-Subsystem
  // (pg-boss ist deferred nach P8), aber HTTP endet vor dem Provider-Kauf. Tests
  // rufen den Drain deterministisch ueber die Queue-Instanz; hier wird er nur angestossen.
  void runProvisioningDrain();
});

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
    const opts = { ...moneyOpts, ...geo };
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
  if (req.auth) console.log("[mcp]", req.auth.email || "anonym", `tenant=${requestTenant(req)}`, req.body?.method || "");
  // Identitaet aus dem verifizierten JWT (req.auth). email bevorzugt, sonst sub
  // (Fail-closed: ein authentifizierter Nutzer OHNE email-Claim wird NICHT zum
  // Owner, sondern bekommt das restriktive DEFAULT_PROFILE). Selbst ohne email UND
  // sub bleibt es restriktiv (ANON_IDENTITY-Sentinel statt null/Owner). Kein
  // req.auth (Legacy/localhost/stdio) -> null -> Owner.
  const identity = req.auth ? req.auth.email || req.auth.sub || ANON_IDENTITY : null;
  const profile = store.resolveProfile(identity);
  try {
    const server = new McpServer({ name: "hermes", version: "0.2.0" });
    registerTools(server, { identity, allowCalendar: profile.allowCalendar });
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
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null });
  }
});
app.get("/mcp", (_req, res) => res.status(405).json({ error: "POST only (stateless transport)" }));
app.delete("/mcp", (_req, res) => res.status(405).json({ error: "POST only (stateless transport)" }));

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
    console.log(`[retention] geloescht: ${removed.calls} Calls, ${removed.notifications} Notifications, ${removed.actionItems} erledigte Action Items (aelter als ${config.retentionDays} Tage)`);
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

// Boot-Guard (Pre-Mortem): der Owner haelt seine Absendernummer im Store, nicht mehr in
// der Env. Nach lokalem Reset (data/store.json geloescht) oder frischem Postgres ohne
// Seed waeren Owner-Outbound + SMS still tot. Fail-closed wie die fruehere
// TWILIO_NUMBER-Boot-Pflicht: ohne aktive Owner-Nummer im Store startet der Dienst
// nicht. Loggt KEINE Nummer (kein Leak), verweist auf das Seed-CLI.
if (!findActiveNumber(store.load(), OWNER_TENANT_ID)) {
  console.error(
    "[boot] Keine aktive Owner-Nummer im Store. Erst seeden: " +
      "npm run seed-owner-number -- <e164> <provider>"
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
  console.log(`  Voice-Engine:   ${config.voiceEngine}${config.voiceEngine === "realtime" && !config.openaiApiKey ? "  (ACHTUNG: OPENAI_API_KEY fehlt!)" : ""}`);
  console.log(`  MCP (HTTP):     ${config.publicUrl || "PUBLIC_URL fehlt!"}/mcp  <- als Custom Connector in Claude eintragen`);
  console.log(`  Twilio-Webhook: ${config.publicUrl || "PUBLIC_URL fehlt!"}/voice/incoming`);
  console.log(`  Status-Callback:${config.publicUrl || "PUBLIC_URL fehlt!"}/voice/status`);
  console.log(`  Allowlist:      ${config.allowedNumbers.join(", ") || "(leer -> Outbound gesperrt)"}`);
  console.log(`  Nummern-Gates:  Land ${config.allowedCountryCodes.join(",")} | max ${config.maxCallsPerHour} Calls/h | Notruf-/Premium-Denylist aktiv`);
});

// Audio-Bridge (nur relevant bei VOICE_ENGINE=realtime)
attachMediaBridge(httpServer, finishCall);

// Voice-Gateway: Twilio-Webhooks (Inbound/Outbound), Audio-Bridge (Realtime),
// MCP ueber Streamable HTTP (/mcp), REST-API fuer Dashboard & stdio-MCP.
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config, assertConfig } from "./config.js";
import * as store from "./store.js";
import { OWNER_TENANT_ID, DEFAULT_PROVIDER, PROVIDER } from "./store/defaults.js";
import { agentTurn, summarizeCall, disclosureSentence } from "./claude.js";
import { registerTools } from "./mcp-tools.js";
import { attachMediaBridge, MEDIA_PATH } from "./bridge.js";
import { createRateLimiter, securityHeaders } from "./middleware.js";
import { mcpAuth, registerWellKnown } from "./auth.js";
import { audit, safeEqual } from "./util.js";
import { voiceControl, messaging, voiceRenderer, inboundSignatureVerifier, providerFromHeaders, ownerNumberForProvider, numberProvisioning } from "./telephony/registry.js";
import { say as sayD, gather as gatherD, hangup as hangupD, redirect as redirectD, stream as streamD } from "./telephony/directives.js";
import { registerTenant, requestNumber, findNumber } from "./store/state-ops.js";
import { provisionNumber } from "./onboarding.js";

const app = express();
// Genau EIN vertrauenswuerdiger Proxy (Render). Nicht `true`: sonst kann jeder Client
// per X-Forwarded-For eine beliebige IP vortaeuschen.
app.set("trust proxy", 1);

// Localhost anhand der echten Socket-Adresse erkennen - req.ip ist hinter trust proxy
// aus X-Forwarded-For abgeleitet und damit von Clients faelschbar.
const isLocalSocket = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

// Identitaet eines internen Aufrufers (Rechteprofile, Phase 2). Die MCP-Tools
// laufen im selben Prozess und rufen die localhost-REST-API mit dem verifizierten
// X-Internal-Identity-Header (aus req.auth.email im /mcp-Handler). Der Header wird
// NUR von localhost-Sockets akzeptiert - von extern ist er faelschbar und wird
// ignoriert (-> Owner). Body-Felder (requestedBy/email) NIE als Identitaet nutzen.
function internalIdentity(req) {
  if (!isLocalSocket(req)) return null;
  const id = req.headers["x-internal-identity"];
  return typeof id === "string" && id ? id : null;
}
// requestedBy-Marker fuer den Owner (localhost/stdio ohne Identitaet).
const OWNER_ID = "owner";
// Sentinel fuer ein verifiziertes Token OHNE email UND sub: bewusst NICHT Owner
// (fail-closed), sondern restriktiv (resolveProfile -> DEFAULT_PROFILE).
const ANON_IDENTITY = "anon";

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
app.use((req, res, next) => {
  if (!config.dashboardPassword) return next();
  if (req.path.startsWith("/voice") || req.path.startsWith("/mcp") ||
      req.path.startsWith("/.well-known") || req.path === "/healthz") return next();
  if (isLocalSocket(req)) return next();
  const expected = "Basic " + Buffer.from("admin:" + config.dashboardPassword).toString("base64");
  if (safeEqual(req.headers.authorization || "", expected)) return next();
  audit("auth_failed", req, `path=${req.path}`);
  res.set("WWW-Authenticate", 'Basic realm="Vodafone Agent"');
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

const normNum = (n) => (typeof n === "string" ? n.replace(/[\s\-()]/g, "") : "");

// ---- Eingabe-Validierung fuer API-Routen ----
const E164 = /^\+[1-9]\d{6,14}$/;
const TEXT_LIMITS = { objective: 500, briefing: 2000, constraints: 2000, caller_name: 100, title: 200 };

// Fehlertext oder null; optionale Felder (null/undefined) sind erlaubt
function invalidText(name, value) {
  if (value == null) return null;
  if (typeof value !== "string") return `${name} muss ein String sein`;
  if (value.length > TEXT_LIMITS[name]) return `${name} ist zu lang (max. ${TEXT_LIMITS[name]} Zeichen)`;
  return null;
}

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

// Direktiven fuer einen Sprach-Turn (Budget-Engine): Gather mit optionalem
// Prompt + Redirect-Fallback auf dieselbe Turn-URL.
function turnDirectives(call, text) {
  const action = `/voice/turn?callId=${call.id}`;
  return [gatherD({ promptText: text, action }), redirectD(action)];
}

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

// Call-Record fuer API-Antworten: streamToken (Zugangsgeheimnis des /media-Streams)
// und interne Flags duerfen den Server nie verlassen.
function publicCall({ streamToken, _finished, ...rest }) {
  return rest;
}

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
  const tenantId = store.findTenantByNumber(to);
  if (!tenantId) {
    audit("inbound_unrouted", req, `to=${to || "-"}`);
    return res.type("text/xml").send(render([
      sayD("Diese Nummer ist nicht erreichbar. Auf Wiederhoeren."),
      hangupD(),
    ], provider));
  }

  // Schnittmenge (R2): pro-Tenant-Budget UND globaler Plattform-Notaus muessen
  // frei sein. Fuer owner-only fallen beide zusammen -> byte-identisch zum Bestand.
  if (store.budgetExceeded(tenantId, config) || store.globalBudgetExceeded(config)) {
    return res.type("text/xml").send(render([
      sayD("Das Demo-Budget ist aufgebraucht. Auf Wiederhoeren."),
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
  });
  store.markAnswered(call.id);
  armMaxDurationTimer(call, req.body.CallSid);

  if (config.voiceEngine === "realtime") {
    return res.type("text/xml").send(render(streamDirectives(call), provider));
  }

  const s = store.load().settings;
  const greeting = s.greeting.replaceAll("{owner}", config.ownerName);
  store.addTranscript(call.id, "agent", greeting);
  res.type("text/xml").send(render(turnDirectives(call, greeting), provider));
});

// ---------------- GESPRAECHS-TURN (Budget-Engine, beide Richtungen) ----------------
app.post("/voice/turn", async (req, res) => {
  const call = store.getCall(req.query.callId);
  if (!call || call.status !== "active") {
    return res.type("text/xml").send(render([hangupD()]));
  }

  // TEMP-DIAGNOSE (Inbound-STT, siehe PLAN-INBOUND-AUDIO-STT.md): zeigt, WELCHE
  // Felder der Provider an /voice/turn postet - nur Feld-NAMEN + Wert-LAENGEN, nie
  // Roh-Werte (DSGVO/PII). Belegt, ob/unter welchem Namen das Transkript ankommt.
  // Nach Befund wieder entfernen (Phase 3 des Plans).
  console.log("[turn-diag]", "provider=" + call.provider,
    "fields=" + Object.entries(req.body || {}).map(([k, v]) => `${k}:${String(v).length}`).join(","));

  const heard = (req.body.SpeechResult || "").trim();
  try {
    if (!heard && call.transcript.some((t) => t.role === "caller")) {
      return res.type("text/xml").send(render(
        turnDirectives(call, "Entschuldigung, ich habe Sie nicht verstanden. Koennen Sie das wiederholen?"),
        call.provider
      ));
    }
    const { speech, endCall } = await agentTurn(call, heard || null);
    const directives = endCall ? [sayD(speech), hangupD()] : turnDirectives(call, speech);
    res.type("text/xml").send(render(directives, call.provider));
  } catch (err) {
    console.error("[turn]", err.message);
    res.type("text/xml").send(render([
      sayD("Entschuldigung, da ist ein technisches Problem aufgetreten. Bitte versuchen Sie es spaeter erneut."),
      hangupD(),
    ], call.provider));
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

  // Pflicht-Offenlegung fest verdrahtet als allererster Satz (kein KI-Ermessen).
  // Vor dem try gebaut, damit auch der Fehlerpfad (agentTurn wirft) sie als
  // ersten Knoten ausgibt - sonst legt der Agent stumm auf (Regel 2).
  const disclosure = disclosureSentence(call);
  store.addTranscript(call.id, "agent", disclosure);
  try {
    const { speech, endCall } = await agentTurn(call, null); // Agent nennt sein Anliegen
    const tail = endCall ? [sayD(speech), hangupD()] : turnDirectives(call, speech);
    res.type("text/xml").send(render([sayD(disclosure), ...tail], call.provider));
  } catch (err) {
    console.error("[outbound]", err.message);
    res.type("text/xml").send(render([sayD(disclosure), hangupD()], call.provider));
  }
});

// ---------------- Call zu Ende -> Summary + Notification + SMS ----------------
// Idempotent: kann von Status-Callback, Bridge und cancel_call gleichzeitig angestossen werden.
async function finishCall(call) {
  if (!call || call._finished) return;
  call._finished = true;
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

    if (config.sendSmsSummary && config.ownerNumber) {
      const sms =
        `[${store.load().settings.agentName}] ${who}\n\n${result.summary}` +
        (aiCount ? `\n\nAction Items:\n` + result.actionItems.map((a, i) => `${i + 1}. ${a}`).join("\n") : "");
      try {
        await messaging(call.provider).sendSms({
          // Owner-From provider-keyed (ownerNumberForProvider): Telnyx-Call ->
          // Telnyx-Owner-Nummer, sonst Twilio-Owner-Nummer. Der Twilio-Zweig ist
          // config.twilioNumber -> byte-identisch zum Bestand.
          from: ownerNumberForProvider(call.provider, config),
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
  const tw = req.body.CallStatus;
  const call = store.getCall(req.body.CallSid) || store.getCall(req.query.callId || "");
  if (!call) return;
  if (tw === "in-progress" || tw === "answered") return void store.markAnswered(call.id);
  if (!["completed", "busy", "no-answer", "failed", "canceled"].includes(tw)) return;
  if (call.status === "active") store.endCallRecord(call.id, tw === "completed" ? "completed" : "failed");
  finishCall(store.getCall(call.id));
});

// ================= REST-API (Dashboard + MCP-Tools) =================

// Outbound-Call starten (Vertrag laut Brief: objective/briefing/constraints/...)
app.post("/api/calls", async (req, res) => {
  const b = req.body || {};
  const to = normNum(b.to);
  const objective = b.objective || b.goal;
  if (!to || !objective) return res.status(400).json({ error: "to und objective sind Pflicht" });

  // Identitaet serverseitig (nur localhost-Header), nie aus dem Body. null = Owner.
  const identity = internalIdentity(req);
  const profile = store.resolveProfile(identity);
  const requestedBy = identity || OWNER_ID;

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
    invalidText("constraints", b.constraints) ||
    invalidText("caller_name", b.caller_name);
  if (textErr) return res.status(400).json({ error: textErr });

  // Outbound-from bleibt Owner bis P5 -> tenantId = OWNER_TENANT_ID. Schnittmenge
  // (R2): pro-Tenant-Budget UND globaler Notaus. Fuer owner-only byte-identisch.
  if (store.budgetExceeded(OWNER_TENANT_ID, config) || store.globalBudgetExceeded(config)) {
    audit("place_call_denied", req, `to=${to} grund=budget`);
    return res.status(402).json({ error: `Budget-Limit von ${config.maxBudgetEur} EUR erreicht.` });
  }

  const maxDur = Math.min(parseInt(b.max_duration_s || config.maxCallDurationS, 10) || 180, 300);
  // Outbound-Provider: Telnyx, sobald eine Telnyx-Absendernummer konfiguriert ist
  // (TELNYX_NUMBER), sonst Twilio-Default. from = passende Owner-Absendernummer
  // (ownerNumberForProvider). Der /voice/outbound-Webhook rendert dank call.provider
  // (P6a) automatisch TeXML statt TwiML.
  const outboundProvider = config.telnyxNumber ? PROVIDER.TELNYX : DEFAULT_PROVIDER;
  const fromNumber = ownerNumberForProvider(outboundProvider, config);
  const call = store.createCall({
    direction: "outbound",
    from: fromNumber,
    to,
    goal: objective,
    briefing: b.briefing,
    constraints: b.constraints,
    callerName: b.caller_name,
    language: b.language || "de",
    maxDurationS: maxDur,
    requestedBy,
    tenantId: OWNER_TENANT_ID,
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
    res.status(500).json({
      error: err.message,
      hint: "Twilio-Trial: Die Zielnummer muss unter 'Verified Caller IDs' verifiziert sein.",
    });
  }
});

// Laufenden Anruf sauber abbrechen
app.post("/api/calls/:id/cancel", async (req, res) => {
  const call = store.getCall(req.params.id);
  if (!call) return res.status(404).json({ error: "not found" });
  if (call.status !== "active") return res.json({ status: call.status });
  audit("cancel_call", req, `call=${call.id}`);
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

// Gesamter Zustand fuers Dashboard (Polling) + MCP-Tools
app.get("/api/state", (req, res) => {
  const s = store.load();
  res.json({
    settings: s.settings,
    calls: s.calls.slice(0, 30).map(publicCall),
    actionItems: s.actionItems.slice(0, 50),
    calendar: store.getCalendar().filter((e) => e.end >= new Date().toISOString()).slice(0, 10),
    // Owner-Bucket im flachen Shape, das Dashboard (public/index.html) +
    // get_agent_status erwarten. usage ist seit P4 eine Map tenantId -> Bucket;
    // die Laufzeit ist owner-only, deshalb der Owner-Bucket.
    usage: { ...s.usage[OWNER_TENANT_ID], maxBudgetEur: config.maxBudgetEur },
    notifications: s.notifications.slice(0, 10),
    agent: {
      number: config.twilioNumber,
      owner: config.ownerName,
      ownerNumber: config.ownerNumber,
      model: config.claudeModel,
      voiceEngine: config.voiceEngine,
      allowedNumbers: config.allowedNumbers,
    },
  });
});

app.get("/api/calls/:id", (req, res) => {
  const call = store.getCall(req.params.id);
  if (!call) return res.status(404).json({ error: "not found" });
  res.json(publicCall(call));
});

// Auskunft/Export (Art. 15/20): nicht-destruktiver Owner-Tenant-Export, read-only,
// hinter der bestehenden /api/*-Basic-Auth. Calls durch publicCall (KEIN
// streamToken-Leak, dieselbe Invariante wie /api/state). BEWUSST KEIN MCP-Tool
// (kein Bulk-Export ueber MCP, Regel 5). Die Loeschung (Art. 17) hat KEINEN
// Endpunkt - nur Script (kleinste Angriffsflaeche, Safety vor Features).
app.get("/api/tenant-data/export", (req, res) => {
  const data = store.exportTenantData(OWNER_TENANT_ID);
  audit("data_export", req,
    `calls=${data.calls.length} actionItems=${data.actionItems.length} notifications=${data.notifications.length}`);
  res.json({ ...data, calls: data.calls.map(publicCall) });
});

app.post("/api/settings", (req, res) => {
  const { settings, changed } = store.updateSettings(req.body || {});
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
  res.json(store.addCalendarEvent(title, startDate.toISOString(), endDate.toISOString()));
});

// ---- Rechteprofile verwalten (Phase 2) ----
// Hinter Basic-Auth (Bestand deckt /api/* ab). OAuth-MCP-Nutzer erreichen nur
// /mcp, nie /api/* -> kein Self-Service. Es gibt bewusst KEIN MCP-Tool dafuer.
// Der Profil-Schluessel ist die serverseitige Identitaet: req.auth.email, wenn der
// IdP eine email im Token liefert, SONST req.auth.sub (z.B. WorkOS "user_01...").
// Deshalb KEINE strikte Email-Form erzwingen - nur ein sauberer, nicht-leerer
// String ohne Whitespace.
const IDENTITY_MAX_LEN = 254; // RFC 5321 (Email-Obergrenze, reicht auch fuer sub)
const validIdentity = (e) => typeof e === "string" && e.length > 0 && e.length <= IDENTITY_MAX_LEN && !/\s/.test(e);

app.get("/api/profiles", (_req, res) => res.json(store.listProfiles()));

app.post("/api/profiles", (req, res) => {
  const { email, ...fields } = req.body || {};
  if (!validIdentity(email)) return res.status(400).json({ error: "email/identity (req.auth.email ODER IdP-sub) ist Pflicht" });
  const { profile, changed } = store.setProfile(email, fields);
  // Nur email + Keys loggen - Profil-Werte (z.B. Nummern) gehoeren nicht ins Log.
  audit("profile_update", req, `email=${email} keys=${changed.join(",") || "-"}`);
  res.json({ email, profile });
});

app.delete("/api/profiles/:email", (req, res) => {
  const { email } = req.params;
  if (!store.deleteProfile(email)) return res.status(404).json({ error: "not found" });
  audit("profile_delete", req, `email=${email}`);
  res.json({ ok: true });
});

// ---- Onboarding (zahlungsfrei): Tenant registrieren -> Nummer anfragen ->
// (optional) echter Provider-Kauf -> aktivieren. Hinter Basic-Auth (Bestand deckt
// /api/* ab; localhost = Owner). BEWUSST KEIN MCP-Tool (kein Self-Service ueber MCP,
// kein offener ungegateter Geld-Endpunkt, R4). Die Kosten-Notbremse ist die
// Nummern-Cap (maxNumbers/maxNumbersPerTenant) - sie ERSETZT das uebersprungene
// Stripe-Schloss. Der echte Provider-Kauf laeuft NUR bei PROVISIONING_ENABLED=true;
// sonst Dry-Run (Nummer bleibt 'requested', KEIN Geld) - fail-closed Default.
const ONBOARD_REASON_STATUS = { tenant_inactive: 403, tenant_cap: 409, global_cap: 429 };

app.post("/api/onboard", async (req, res) => {
  const tenantId = (req.body || {}).tenantId;
  if (!validIdentity(tenantId))
    return res.status(400).json({ error: "tenantId ist Pflicht (nicht leer, ohne Whitespace, <=254 Zeichen)" });

  const s = store.load();
  registerTenant(s, tenantId);
  const reqRes = requestNumber(s, {
    tenantId,
    provider: PROVIDER.TELNYX,
    maxNumbers: config.maxNumbers,
    maxNumbersPerTenant: config.maxNumbersPerTenant,
  });
  if (!reqRes.ok) {
    audit("onboard_denied", req, `tenant=${tenantId} grund=${reqRes.reason}`);
    return res.status(ONBOARD_REASON_STATUS[reqRes.reason] || 400).json({ error: `Nummer-Anfrage abgelehnt (${reqRes.reason})` });
  }
  store.save(); // 'requested' persistieren (auch im Dry-Run)
  const numberId = reqRes.number.id;
  audit("onboard_request", req, `tenant=${tenantId} number=${numberId}`);

  // Dry-Run (Default, fail-closed): kein echter Kauf, Nummer bleibt 'requested'.
  if (!config.provisioningEnabled)
    return res.json({ tenantId, numberId, status: reqRes.number.status, provisioning: "disabled" });

  // Echter Provider-Kauf (gedeckelt durch die Cap oben). Fehlerpfad in der
  // Orchestrierung: failed + Provider-Release (kein bezahlter Orphan).
  try {
    const number = await provisionNumber(s, numberProvisioning(PROVIDER.TELNYX), {
      numberId,
      countryCode: config.provisioningCountry,
      connectionId: config.telnyxConnectionId,
    });
    store.save();
    audit("onboard_active", req, `tenant=${tenantId} number=${numberId} e164=${number.e164}`);
    res.json({ tenantId, numberId, status: number.status, e164: number.e164 });
  } catch (err) {
    store.save(); // 'failed' persistieren
    console.error("[onboard]", err.message);
    res.status(502).json({ error: "Nummern-Provisioning fehlgeschlagen", numberId, status: findNumber(s, numberId)?.status });
  }
});

// ================= MCP ueber Streamable HTTP (Custom Connector) =================
// Stateless: pro Request ein frischer Server+Transport (einfach & robust fuer den Prototyp).
// Auth via mcpAuth-Middleware (src/auth.js): Legacy-Bearer-Token, statisches
// Token oder OAuth 2.1 (MCP_AUTH). Fail-closed bleibt Default (nur localhost).
app.post("/mcp", mcpAuth, async (req, res) => {
  if (req.auth) console.log("[mcp]", req.auth.email || "anonym", req.body?.method || "");
  // Identitaet aus dem verifizierten JWT (req.auth). email bevorzugt, sonst sub
  // (Fail-closed: ein authentifizierter Nutzer OHNE email-Claim wird NICHT zum
  // Owner, sondern bekommt das restriktive DEFAULT_PROFILE). Selbst ohne email UND
  // sub bleibt es restriktiv (ANON_IDENTITY-Sentinel statt null/Owner). Kein
  // req.auth (Legacy/localhost/stdio) -> null -> Owner.
  const identity = req.auth ? req.auth.email || req.auth.sub || ANON_IDENTITY : null;
  const profile = store.resolveProfile(identity);
  try {
    const server = new McpServer({ name: "vodafone-agent", version: "0.2.0" });
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
const httpServer = app.listen(config.port, () => {
  // Tatsaechlichen Port verwenden: bei PORT=0 (Tests) vergibt das OS einen freien Port
  const port = httpServer.address().port;
  // Eigene REST-API fuer die MCP-Tools erreichbar machen (auch bei abweichendem PORT)
  process.env.GATEWAY_URL ||= `http://localhost:${port}`;
  console.log(`\n  Vodafone Agent Gateway laeuft auf http://localhost:${port}`);
  console.log(`  Dashboard:      http://localhost:${port}`);
  console.log(`  Voice-Engine:   ${config.voiceEngine}${config.voiceEngine === "realtime" && !config.openaiApiKey ? "  (ACHTUNG: OPENAI_API_KEY fehlt!)" : ""}`);
  console.log(`  MCP (HTTP):     ${config.publicUrl || "PUBLIC_URL fehlt!"}/mcp  <- als Custom Connector in Claude eintragen`);
  console.log(`  Twilio-Webhook: ${config.publicUrl || "PUBLIC_URL fehlt!"}/voice/incoming`);
  console.log(`  Status-Callback:${config.publicUrl || "PUBLIC_URL fehlt!"}/voice/status`);
  console.log(`  Allowlist:      ${config.allowedNumbers.join(", ") || "(leer -> Outbound gesperrt)"}`);
  console.log(`  Nummern-Gates:  Land ${config.allowedCountryCodes.join(",")} | max ${config.maxCallsPerHour} Calls/h | Notruf-/Premium-Denylist aktiv`);
  if (!ok) console.log("  ACHTUNG: .env unvollstaendig, Telefonie funktioniert noch nicht.\n");
});

// Audio-Bridge (nur relevant bei VOICE_ENGINE=realtime)
attachMediaBridge(httpServer, finishCall);

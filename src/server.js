// Voice-Gateway: Twilio-Webhooks (Inbound/Outbound), Audio-Bridge (Realtime),
// MCP ueber Streamable HTTP (/mcp), REST-API fuer Dashboard & stdio-MCP.
import express from "express";
import twilio from "twilio";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config, assertConfig } from "./config.js";
import * as store from "./store.js";
import { agentTurn, summarizeCall, disclosureSentence } from "./claude.js";
import { registerTools } from "./mcp-tools.js";
import { attachMediaBridge } from "./bridge.js";
import { createRateLimiter, securityHeaders } from "./middleware.js";
import { audit, safeEqual } from "./util.js";

const app = express();
// Genau EIN vertrauenswuerdiger Proxy (Render). Nicht `true`: sonst kann jeder Client
// per X-Forwarded-For eine beliebige IP vortaeuschen.
app.set("trust proxy", 1);

// Localhost anhand der echten Socket-Adresse erkennen - req.ip ist hinter trust proxy
// aus X-Forwarded-For abgeleitet und damit von Clients faelschbar.
const isLocalSocket = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

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
app.use(express.urlencoded({ extended: false, limit: BODY_LIMIT })); // Twilio-Webhooks
app.use(express.json({ limit: BODY_LIMIT })); // eigene API + MCP

// Body-Parser-Fehler (413 zu gross, 400 kaputtes JSON) als JSON statt HTML beantworten
app.use((err, _req, res, next) => {
  if (!err.status || err.status < 400 || err.status >= 500) return next(err);
  res.status(err.status).json({ error: err.type || "bad request" });
});

// ---- Basic-Auth fuer Dashboard + API (Public Hosting). Ausgenommen:
// /voice/* (eigene Twilio-Signaturpruefung), /mcp (eigenes Bearer-Token),
// /healthz (Keep-Alive) und localhost (interne MCP-Tools).
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.use((req, res, next) => {
  if (!config.dashboardPassword) return next();
  if (req.path.startsWith("/voice") || req.path.startsWith("/mcp") || req.path === "/healthz") return next();
  if (isLocalSocket(req)) return next();
  const expected = "Basic " + Buffer.from("admin:" + config.dashboardPassword).toString("base64");
  if (safeEqual(req.headers.authorization || "", expected)) return next();
  audit("auth_failed", req, `path=${req.path}`);
  res.set("WWW-Authenticate", 'Basic realm="Vodafone Agent"');
  res.status(401).send("Auth required");
});
app.use(express.static(config.publicDir));

// ---- Twilio-Signaturpruefung fuer alle /voice-Webhooks ----
// Twilio signiert jeden Request (HMAC-SHA1 ueber URL+Params mit dem Auth-Token).
// Ohne diese Pruefung kann jeder, der die URL kennt, Anrufe/Transkripte faelschen
// und Claude-Turns (=Kosten) ausloesen.
app.use("/voice", (req, res, next) => {
  if (config.skipTwilioSignatureCheck) return next();
  const signature = req.headers["x-twilio-signature"] || "";
  const url = config.publicUrl + req.originalUrl;
  if (!config.publicUrl || !twilio.validateRequest(config.twilioToken, signature, url, req.body || {}))
    return res.status(403).send("invalid twilio signature");
  next();
});

const VoiceResponse = twilio.twiml.VoiceResponse;
const twilioClient = () => twilio(config.twilioSid, config.twilioToken, { edge: config.twilioEdge });

// Deutsche Neural-Stimme + deutsche Spracherkennung (Budget-Engine)
const VOICE = { voice: "Polly.Vicki-Neural", language: "de-DE" };
const GATHER = {
  input: "speech",
  language: "de-DE",
  speechTimeout: "auto",
  speechModel: "deepgram_nova-2-general",
  actionOnEmptyResult: true,
};

const say = (node, text) => node.say(VOICE, text);
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

function allowlistError(to) {
  if (!config.allowedNumbers.length)
    return "Allowlist ist leer (ALLOWED_NUMBERS in .env). Outbound-Anrufe sind gesperrt.";
  if (!config.allowedNumbers.includes(normNum(to)))
    return `Nummer ${to} steht nicht in der Allowlist (ALLOWED_NUMBERS). Anruf verweigert.`;
  return null;
}

function gatherTurn(vr, call, text) {
  const g = vr.gather({ ...GATHER, action: `/voice/turn?callId=${call.id}`, method: "POST" });
  if (text) g.say(VOICE, text);
  vr.redirect({ method: "POST" }, `/voice/turn?callId=${call.id}`);
}

// Realtime-Engine: Anruf-Audio per Media Stream an die Bridge haengen.
// stream_token authentifiziert den WebSocket: das TwiML sieht nur Twilio,
// die Bridge prueft das Token beim start-Event (bridge.js).
function streamTwiml(call) {
  const vr = new VoiceResponse();
  const connect = vr.connect();
  const stream = connect.stream({ url: config.publicUrl.replace(/^https/, "wss") + "/media" });
  stream.parameter({ name: "call_id", value: call.id });
  stream.parameter({ name: "stream_token", value: call.streamToken });
  return vr;
}

// Call-Record fuer API-Antworten: streamToken (Zugangsgeheimnis des /media-Streams)
// und interne Flags duerfen den Server nie verlassen.
function publicCall({ streamToken, _finished, ...rest }) {
  return rest;
}

// Max-Dauer hart durchsetzen (Budget-Engine; Realtime macht das die Bridge)
function armMaxDurationTimer(call, twilioSid) {
  const limit = (call.maxDurationS || config.maxCallDurationS) * 1000;
  setTimeout(() => {
    const c = store.getCall(call.id);
    if (c?.status === "active" && twilioSid)
      twilioClient().calls(twilioSid).update({ status: "completed" }).catch(() => {});
  }, limit);
}

// ---------------- INBOUND ----------------
// Twilio-Nummer -> "A call comes in" -> POST {PUBLIC_URL}/voice/incoming
app.post("/voice/incoming", (req, res) => {
  if (store.budgetExceeded(config)) {
    const vr = new VoiceResponse();
    say(vr, "Das Demo-Budget ist aufgebraucht. Auf Wiederhoeren.");
    vr.hangup();
    return res.type("text/xml").send(vr.toString());
  }

  const call = store.createCall({
    direction: "inbound",
    from: req.body.From || "unbekannt",
    to: req.body.To || config.twilioNumber,
    twilioSid: req.body.CallSid,
  });
  store.markAnswered(call.id);
  armMaxDurationTimer(call, req.body.CallSid);

  if (config.voiceEngine === "realtime") {
    return res.type("text/xml").send(streamTwiml(call).toString());
  }

  const vr = new VoiceResponse();
  const s = store.load().settings;
  const greeting = s.greeting.replaceAll("{owner}", config.ownerName);
  store.addTranscript(call.id, "agent", greeting);
  gatherTurn(vr, call, greeting);
  res.type("text/xml").send(vr.toString());
});

// ---------------- GESPRAECHS-TURN (Budget-Engine, beide Richtungen) ----------------
app.post("/voice/turn", async (req, res) => {
  const call = store.getCall(req.query.callId);
  const vr = new VoiceResponse();
  if (!call || call.status !== "active") {
    vr.hangup();
    return res.type("text/xml").send(vr.toString());
  }

  const heard = (req.body.SpeechResult || "").trim();
  try {
    if (!heard && call.transcript.some((t) => t.role === "caller")) {
      gatherTurn(vr, call, "Entschuldigung, ich habe Sie nicht verstanden. Koennen Sie das wiederholen?");
      return res.type("text/xml").send(vr.toString());
    }
    const { speech, endCall } = await agentTurn(call, heard || null);
    if (endCall) {
      say(vr, speech);
      vr.hangup();
    } else {
      gatherTurn(vr, call, speech);
    }
  } catch (err) {
    console.error("[turn]", err.message);
    say(vr, "Entschuldigung, da ist ein technisches Problem aufgetreten. Bitte versuchen Sie es spaeter erneut.");
    vr.hangup();
  }
  res.type("text/xml").send(vr.toString());
});

// ---------------- OUTBOUND: Angerufener nimmt ab ----------------
app.post("/voice/outbound", async (req, res) => {
  const call = store.getCall(req.query.callId);
  if (!call) {
    const vr = new VoiceResponse();
    vr.hangup();
    return res.type("text/xml").send(vr.toString());
  }
  call.twilioSid = req.body.CallSid || call.twilioSid;
  store.markAnswered(call.id);
  store.save();

  if (config.voiceEngine === "realtime") {
    return res.type("text/xml").send(streamTwiml(call).toString());
  }

  const vr = new VoiceResponse();
  try {
    // Pflicht-Offenlegung fest verdrahtet als allererster Satz (kein KI-Ermessen)
    const disclosure = disclosureSentence(call);
    store.addTranscript(call.id, "agent", disclosure);
    say(vr, disclosure);
    const { speech, endCall } = await agentTurn(call, null); // Agent nennt sein Anliegen
    if (endCall) {
      say(vr, speech);
      vr.hangup();
    } else {
      gatherTurn(vr, call, speech);
    }
  } catch (err) {
    console.error("[outbound]", err.message);
    vr.hangup();
  }
  res.type("text/xml").send(vr.toString());
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
    const aiCount = (result.actionItems || []).length;
    const who = call.direction === "outbound" ? `Anruf bei ${call.to}` : `Anruf von ${call.from}`;
    store.addNotification("Neue Call Summary", `${who}: ${result.summary}`, call.id);

    if (config.sendSmsSummary && config.ownerNumber) {
      const sms =
        `[${store.load().settings.agentName}] ${who}\n\n${result.summary}` +
        (aiCount ? `\n\nAction Items:\n` + result.actionItems.map((a, i) => `${i + 1}. ${a}`).join("\n") : "");
      try {
        await twilioClient().messages.create({
          from: config.twilioNumber,
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
  if (!E164.test(to)) return res.status(400).json({ error: "to muss E.164 sein, z.B. +4917212345678" });
  const textErr =
    invalidText("objective", objective) ||
    invalidText("briefing", b.briefing) ||
    invalidText("constraints", b.constraints) ||
    invalidText("caller_name", b.caller_name);
  if (textErr) return res.status(400).json({ error: textErr });

  const gateErr = allowlistError(to);
  if (gateErr) {
    audit("place_call_denied", req, `to=${to} grund=allowlist`);
    return res.status(403).json({ error: gateErr });
  }
  if (store.budgetExceeded(config)) {
    audit("place_call_denied", req, `to=${to} grund=budget`);
    return res.status(402).json({ error: `Budget-Limit von ${config.maxBudgetEur} EUR erreicht.` });
  }

  const maxDur = Math.min(parseInt(b.max_duration_s || config.maxCallDurationS, 10) || 180, 300);
  const call = store.createCall({
    direction: "outbound",
    from: config.twilioNumber,
    to,
    goal: objective,
    briefing: b.briefing,
    constraints: b.constraints,
    callerName: b.caller_name,
    language: b.language || "de",
    maxDurationS: maxDur,
  });
  audit("place_call", req, `to=${to} call=${call.id}`);

  try {
    const tw = await twilioClient().calls.create({
      from: config.twilioNumber,
      to,
      url: `${config.publicUrl}/voice/outbound?callId=${call.id}`,
      statusCallback: `${config.publicUrl}/voice/status?callId=${call.id}`,
      statusCallbackEvent: ["answered", "completed"],
      method: "POST",
      timeLimit: maxDur,
    });
    call.twilioSid = tw.sid;
    store.save();
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
      await twilioClient().calls(call.twilioSid).update({ status: "completed" });
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
    usage: { ...s.usage, maxBudgetEur: config.maxBudgetEur },
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

// ================= MCP ueber Streamable HTTP (Custom Connector) =================
// Stateless: pro Request ein frischer Server+Transport (einfach & robust fuer den Prototyp).
// Auth: statisches Bearer-Token (bewusste Prototyp-Abweichung von OAuth 2.1).
// Fail-closed: ohne konfiguriertes Token ist /mcp nur von localhost erreichbar.
app.post("/mcp", async (req, res) => {
  if (config.mcpAuthToken) {
    if (!safeEqual(req.headers.authorization || "", `Bearer ${config.mcpAuthToken}`)) {
      audit("auth_failed", req, "path=/mcp");
      return res.status(401).json({ error: "unauthorized" });
    }
  } else if (!isLocalSocket(req)) {
    audit("auth_failed", req, "path=/mcp");
    return res.status(401).json({ error: "MCP_AUTH_TOKEN nicht gesetzt - /mcp ist nur von localhost erreichbar" });
  }
  try {
    const server = new McpServer({ name: "vodafone-agent", version: "0.2.0" });
    registerTools(server);
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
  if (!ok) console.log("  ACHTUNG: .env unvollstaendig, Telefonie funktioniert noch nicht.\n");
});

// Audio-Bridge (nur relevant bei VOICE_ENGINE=realtime)
attachMediaBridge(httpServer, finishCall);

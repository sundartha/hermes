// Brain-Shim (PLAN-TELNYX-AI-ASSISTANT.md, Phase P1): in-house /v1/chat/completions-
// kompatibler Endpunkt. Kapselt agentTurn (claude.js) und framt die Antwort OpenAI-spec-
// konform (stab-p6): stream:true -> SSE-Delta-Sequenz (role-Chunk, content-Chunk, separater
// finish-Chunk, data:[DONE]); stream:false/fehlend -> plain chat.completion-JSON. Modus
// wird per-Request aus req.body.stream ausgehandelt. Bei C-Telnyx UND C-ElevenLabs identisch.
// Existenz fail-closed hinter TELNYX_AI_ASSISTANT_ENABLED (404 bis Cutover); Auth ueber
// ein statisches Telnyx-Integration-Secret (E2) + call_control_id-Korrelation (E1).
// KEINE Safety-Gate-Umgehung, KEINE llm.js-Aenderung, KEIN Direktimport von execTool/
// toolDefs (agentTurn ruft sie in-house auf -> S2-Anti-Duplizierung).
import { randomUUID } from "node:crypto";
import { safeEqual } from "./util.js";
import { degradedSpeechFor } from "./llm.js";
import { makeFixedWindowCounter } from "./middleware.js";
import { metrics as defaultMetrics } from "./metrics.js";
import { makeCallControlTerminator } from "./telnyx-call-terminate.js";

// OpenAI-SSE-Konstanten (G25, keine Magic-Strings gestreut):
const OPENAI_CHUNK_OBJECT = "chat.completion.chunk"; // stream:true (SSE-Delta-Chunks)
const OPENAI_COMPLETION_OBJECT = "chat.completion"; // stream:false (plain JSON)
const CHAT_COMPLETION_ID_PREFIX = "chatcmpl-";
const FINISH_STOP = "stop";
const ASSISTANT_ROLE = "assistant";
const SSE_CONTENT_TYPE = "text/event-stream";
const SSE_DONE = "data: [DONE]\n\n";
const BEARER_PREFIX = "Bearer ";
const MS_PER_SECOND = 1000;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_PAYMENT_REQUIRED = 402;
// P5: per-callId-Fenster fuer den Shim-Turn-Rate-Limiter, unabhaengig vom globalen
// Per-IP-Fenster (middleware.js RATE_WINDOW_MS) - eigene Achse, eigenes Sweep-Intervall.
const SHIM_RATE_WINDOW_MS = 60_000;
const SHIM_RATE_SWEEP_MS = 5 * 60_000;

// Statischer Bearer-Wert (ohne "Bearer "-Praefix) aus dem Authorization-Header;
// fail-closed "" (kein Header/kein Praefix). EINE Quelle (G5) fuer den Slice.
function bearerFrom(authHeader) {
  return typeof authHeader === "string" && authHeader.startsWith(BEARER_PREFIX)
    ? authHeader.slice(BEARER_PREFIX.length)
    : "";
}

// Non-Null-Objekt-Guard (G5: EINE Quelle statt verstreuter Inline-Checks) - liefert
// candidate zurueck, wenn es ein nicht-null Objekt ist, sonst fail-closed null.
function asObject(candidate) {
  return candidate && typeof candidate === "object" ? candidate : null;
}

// ccid-Praesenz an den zwei LEGACY-forward_metadata-Positionen: body.metadata.
// call_control_id und body.call_control_id (Top-Level). Diese Positionen tragen die ccid
// seit P2 NICHT (metadata leer; die ccid steht in extra_metadata) - die Korrelation liest
// sie daher NICHT. Einziger Aufrufer ist der OBS-FLAG-Shape-Dump (forwardMetadataShape),
// der als Drift-Detektor meldet, falls Telnyx die ccid je wieder in eine Legacy-Position
// legt. Reine Extraktion, keine Aggregation.
function ccidCandidates(body) {
  const meta = asObject(body?.metadata);
  return { metaCcid: meta && meta.call_control_id, topCcid: body && body.call_control_id };
}

// E1: extrahiert die Telnyx-eigene call_control_id aus dem forward_metadata-BODY des
// Shim-Requests. LIVE BESTAETIGT [2026-07-11, P2 call_mrgj8trkypk8, Feld=extra_metadata]:
// Telnyx legt die Call-Daten unter `extra_metadata` ab (getrennt von OpenAIs nativem
// `metadata`, das leer bleibt). SINGLE TRUSTED SOURCE - KEIN `metadata`- und KEIN
// spoofbarer Top-Level-`call_control_id`-Fallback: eine geleakte, angreiferkontrollierte
// Top-Level-callId darf NIE einen fremden aktiven Call adressieren (Anti-Spoofing).
// Fail-closed -> null (kein resolvebarer Call -> 403, KEIN Turn/Token-Burn).
export function callControlIdFromForwardedMetadata(body) {
  const extra = asObject(body?.extra_metadata);
  const candidate = extra && extra.call_control_id;
  return typeof candidate === "string" && candidate ? candidate : null;
}

// Sicheres OpenAI-messages-Array (nur echte Arrays, sonst leer) - EINE Quelle (G5) fuer
// lastUserText UND die P5-Shape-Diagnose, statt den Array-Guard zweimal inline zu wiederholen.
function messagesArray(body) {
  return Array.isArray(body?.messages) ? body.messages : [];
}

// Letzte User-Aeusserung aus dem OpenAI-messages-Array (nur STRING-Content, sonst "").
// Der Shim nutzt NUR die neueste Aeusserung als callerText; die Gespraechs-Historie
// lebt im Store (call.transcript, agentTurn baut sie frisch) - kein Vertrauen in die
// vom Provider gespiegelte messages-Kette (Spoofing-/Drift-Schutz, Invariante 5).
function lastUserText(body) {
  const messages = messagesArray(body);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

// P5 (Diskriminator R6/§2.2): PII-freie Form-Fakten des eingehenden messages-Payloads
// verknuepft mit dem Turn-Ergebnis. NUR Counts/Typ-Namen/Laengen/Booleans - NIE
// Nachrichtentext, keine E.164, kein Secret.

// Nachrichten je bekannter Rolle; unbekannte/fehlende Rollen -> "other" (bounded, damit
// kein angreiferkontrollierter Rollen-String in den Log geraet).
function roleCounts(messages) {
  const counts = { system: 0, user: 0, assistant: 0, other: 0 };
  for (const m of messages) {
    const role = m && m.role;
    if (role === "system" || role === "user" || role === "assistant") counts[role] += 1;
    else counts.other += 1;
  }
  return counts;
}

// Roh-Content-Form der LETZTEN user-Message: Typ-Name + Laenge (Zahl), nie der Wert.
// contentType "missing" (keine user-Message) | "string" | "array" | "other";
// length = String-Zeichen bzw. Array-Elemente, sonst 0. Deckt den Array-Content-Drop auf
// (lastUserText liefert nur String-Content als callerText).
function lastUserContentShape(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user") {
      const content = m.content;
      if (typeof content === "string") return { contentType: "string", length: content.length };
      if (Array.isArray(content)) return { contentType: "array", length: content.length };
      return { contentType: "other", length: 0 };
    }
  }
  return { contentType: "missing", length: 0 };
}

// Verknuepft den eingehenden messages-Payload mit dem erzeugten Turn-Ergebnis zu EINER
// PII-freien Diagnose-Zeile. speechEmpty ist der §2.2-Diskriminator: agentTurn.speech hat
// einen Fallback (nie leer) - ist es hier doch leer, ist das eine Anomalie UNSERES Formats;
// ist es nicht-leer und der Anrufer hoert nichts, liegt es am Vendor/TTS.
// EINE Quelle (G5) fuer den gesprochenen Turn-Text: nur echter String-Content, sonst "".
// Genutzt von der PII-freien Shape-Diagnose (speechEmpty) UND als Basis der afix-p3-
// Sprechdauer-Schaetzung - vorher stand dieser Guard inline in messagesTurnShape.
function speechTextOf(turn) {
  return turn && typeof turn.speech === "string" ? turn.speech : "";
}

function messagesTurnShape(body, turn) {
  const messages = messagesArray(body);
  const { contentType, length } = lastUserContentShape(messages);
  const speech = speechTextOf(turn);
  return {
    messagesCount: messages.length,
    roleCounts: roleCounts(messages),
    lastUserContentType: contentType,
    lastUserLength: length,
    lastUserTextPresent: lastUserText(body).trim().length > 0,
    speechEmpty: speech.length === 0,
  };
}

// Gemeinsame OpenAI-Completion-Huelle (id/created/model) - EINMAL je Response gebaut und
// von beiden Modi (JSON + SSE-Chunks) geteilt (S2). id/created bleiben ueber alle SSE-
// Chunks EINER Antwort stabil (OpenAI-Verhalten).
function completionEnvelope(model) {
  return {
    id: CHAT_COMPLETION_ID_PREFIX + randomUUID(),
    created: Math.floor(Date.now() / MS_PER_SECOND),
    model,
  };
}

// Serialisiert EIN SSE-data-Event (G5: EINE Quelle fuer das Draht-Framing).
function writeSseEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// Ein chat.completion.chunk mit gegebenem delta + finish_reason (G5: alle drei SSE-Chunks
// teilen dieselbe Bau-Logik, nur delta/finish_reason variieren).
function streamChunk(envelope, delta, finishReason) {
  return {
    ...envelope,
    object: OPENAI_CHUNK_OBJECT,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

// stream:true -> OpenAI-spec-konforme SSE-Sequenz: role-Delta-Chunk, dann content-Delta-
// Chunk, dann SEPARATER finish_reason-Chunk (delta:{}), dann data:[DONE]. Der Turn-TEXT
// bleibt unveraendert - nur die Draht-Repraesentation wird spec-konform.
function writeStreamingCompletion(res, { model, content }) {
  res.setHeader("Content-Type", SSE_CONTENT_TYPE);
  const envelope = completionEnvelope(model);
  writeSseEvent(res, streamChunk(envelope, { role: ASSISTANT_ROLE }, null));
  writeSseEvent(res, streamChunk(envelope, { content }, null));
  writeSseEvent(res, streamChunk(envelope, {}, FINISH_STOP));
  res.write(SSE_DONE);
  res.end();
}

// stream:false (oder fehlend) -> plain chat.completion-JSON mit message.role/.content +
// finish_reason (kein SSE-Framing). res.json setzt Content-Type application/json + beendet.
function writeJsonCompletion(res, { model, content }) {
  res.json({
    ...completionEnvelope(model),
    object: OPENAI_COMPLETION_OBJECT,
    choices: [{ index: 0, message: { role: ASSISTANT_ROLE, content }, finish_reason: FINISH_STOP }],
  });
}

// EIN Dispatch-Punkt (G23 One-Switch) fuer beide Modi - honoriert req.body.stream. Die vier
// Aufrufer (rate/budget/happy/degradation) uebergeben denselben ausgehandelten stream-Modus,
// damit die Modus-Weiche NICHT an vier Stellen dupliziert wird (S2). stream ist ein
// Protokoll-Parameter, der mit dem Request reist - kein Verhaltens-Selektor des Aufrufers.
function writeCompletion(res, { model, content, stream }) {
  if (stream) writeStreamingCompletion(res, { model, content });
  else writeJsonCompletion(res, { model, content });
}

// OBS-1 (Observability Shim-Gates): EINE Quelle (G5) fuer die strukturierte, PII-/secret-
// freie Diagnose-Zeile jeder stummen 403-/Degradations-Flaeche. Format wie metrics.js:
// Prefix + kind + JSON(payload). Der Payload traegt NUR Grund-Token/Booleans/interne
// call.id/tenantId/Status - NIE Header-/Secret-/Transkript-Werte, NIE den rohen Body
// (objectKeys statt Werte, kein Rekursions-Dump). SAFE-1 sichert das dauerhaft ab.
const SHIM_LOG_PREFIX = "[telnyx-shim]";

function formatShimLine(kind, payload) {
  return `${SHIM_LOG_PREFIX} ${kind} ${JSON.stringify(payload)}`;
}

// Ein greifendes Gate / eine Degradation / ein Vendor-Fehler wird LAUT statt stumm 403.
function logShimGate(payload) {
  console.warn(formatShimLine("gate", payload));
}

// Erfolgreicher Turn - UNCONDITIONAL (unabhaengig von metricsEnabled). Im Vorfall war
// metricsEnabled AUS = Null-Turn-Signal; genau diese Luecke schliesst turn_ok. Nur
// call.id + latencyMs + turnSeq (PII-frei), separater Kanal/Prefix als der opt-in
// metrics-Seam. turnSeq (K0, PLAN-CONVERSATION-OPTIMIZATION.md) ist der laufende
// Shim-Request-Zaehler dieses Calls (watchdog.observeTurn) - zaehlt NUR Requests, die die
// vorgelagerten Gates (Existenz-Flag, Auth, ccid-Korrelation, Call-aktiv) bereits passiert
// haben, NICHT jeden Telnyx-Aufruf des Shims. Macht ueber mehrere Zeilen (turn_ok UND die
// Gate-/Fehler-Zeilen unten, S3-4/MINOR-1) sichtbar, wie viele Turns dieser Call bereits
// verbraucht hat - Vorbedingung fuer die spaetere Eager-EOT-Kostensichtbarkeit (K8).
function logShimTurnOk(payload) {
  console.log(formatShimLine("turn_ok", payload));
}

// afix-p3: der Hangup ist geplant, nicht ausgefuehrt - ohne diese Zeile waere im Live-Log
// nicht unterscheidbar, ob end_call gefallen ist. callId + delayMs + turnSeq (MINOR-1-Fix, 2.
// Review-Runde: turnSeq dokumentiert, nach wie vielen Turns der Call den Abschied ausgeloest
// hat - PII-frei, kein Text).
function logShimFarewell(payload) {
  console.log(formatShimLine("farewell_scheduled", payload));
}

// OBS-FLAG (TELNYX_SHIM_DEBUG_SHAPE, default aus): Shape-Dump als eigenes Watched-Token
// (kind="shape"), in den Logs vom gate-Token unterscheidbar. Wie logShimGate console.warn,
// keys-only Payload (Regel 4).
function logShimShape(payload) {
  console.warn(formatShimLine("shape", payload));
}

// Nur die Feld-NAMEN eines erwarteten Objekts (nie Werte, kein Rekursions-Dump) - legt am
// no_ccid-Gate die reale forward_metadata-Form offen, ohne PII/Secrets zu leaken.
function objectKeys(value) {
  return value && typeof value === "object" ? Object.keys(value) : [];
}

// OBS-FLAG: reine Shape-Fakten des forward_metadata-Body - Top-Level-Feldnamen (keys-only)
// plus zwei Praesenz-Booleans fuer die zwei LEGACY-Positionen der call_control_id (metadata
// vs top-level). Seit P1b-FIX korreliert der Shim ueber extra_metadata; diese Booleans sind
// damit ein Drift-Detektor, waehrend bodyKeys weiter zeigt, dass extra_metadata praesent
// ist. Nie Werte, kein Rekursions-Dump, keine Innenfeldnamen (Regel 4).
function forwardMetadataShape(body) {
  const { metaCcid, topCcid } = ccidCandidates(body);
  return {
    bodyKeys: objectKeys(body),
    ccidInMetadata: typeof metaCcid === "string" && Boolean(metaCcid),
    ccidTopLevel: typeof topCcid === "string" && Boolean(topCcid),
  };
}

// Vendor-HTTP-Status eines gefangenen Fehlers (Anthropic err.status ODER Telnyx
// err.providerStatus), sonst null - fuer das 402-Watched-Token (stiller Guthaben-Killer).
function vendorStatusOf(err) {
  const status = err && (err.providerStatus ?? err.status);
  return typeof status === "number" ? status : null;
}

export function makeTelnyxLlmShim({
  store,
  config,
  agentTurn,
  localeFor,
  voiceControl,
  watchdog,
  metrics = defaultMetrics,
}) {
  // P5 (Scope 4, Carryover aus P4): per-callId-Fixed-Window - Toll-/Token-Fraud-Bremse
  // VOR agentTurn, zusaetzlich zum globalen Per-IP-Limiter + Budget-Cap. EINE Quelle
  // (makeFixedWindowCounter, G5) statt einer zweiten Zaehler-Implementierung hier.
  const shimRateHit = makeFixedWindowCounter({
    windowMs: SHIM_RATE_WINDOW_MS,
    limit: config.telnyxShimMaxTurnsPerMin,
    sweepMs: SHIM_RATE_SWEEP_MS,
  });

  // stab-p9 (S2/G5): fail-safe Call-Control-Hangup ueber das GETEILTE Primitiv (auch der
  // Dead-Air-Watchdog nutzt es). Byte-identisches Verhalten/Log wie zuvor (SHIM_LOG_PREFIX).
  const terminateViaCallControl = makeCallControlTerminator({ store, voiceControl, logPrefix: SHIM_LOG_PREFIX });

  // stab-p9-FIX (Review-Blocker P9-WD1): jede shim-getriebene Terminierung MUSS den
  // Dead-Air-Timer SOFORT loeschen. observeTurn (Schritt 4.6) armiert den Timer auf JEDEM
  // Turn VOR allen drei Gates - im Moment der Terminierung ist er also immer frisch
  // gestellt. Das Loeschen passiert sonst NUR verzoegert ueber den spaeter eintreffenden
  // call.hangup-Webhook (onHangup ruft dort watchdog.clear); bleibt dieser aus oder kommt
  // er zu spaet, feuert der Timer fuer einen bereits (aus anderem Grund) beendeten Call
  // erneut: zweiter Hangup-Versuch PLUS ein irrefuehrendes dead_air-Log. Ein Aufruf
  // erledigt Hangup+Clear zusammen (G5) - kein Aufrufer kann das Clear vergessen. Genutzt
  // vom Loop-Guard (Schritt 4.6) und Mid-Call-Budget-Kill (Schritt 6, P6) - beides Notaus-
  // Pfade, die SOFORT terminieren. end_call (Schritt 8) terminiert seit afix-p3 NICHT mehr
  // hierueber, sondern verzoegert ueber watchdog.scheduleFarewellHangup (Schutz des
  // Abschiedssatzes, R4). KEIN Store-Write - Settlement bleibt P4.5 onHangup.
  async function terminateCall(callId) {
    await terminateViaCallControl(callId);
    watchdog.clear(callId);
  }

  return async function handleChatCompletion(req, res) {
    // 1) Existenz-Gate (Invariante 1): Flag aus -> 404, VOR jeder Arbeit/Parsing.
    if (!config.telnyxAiAssistantEnabled) return res.status(HTTP_NOT_FOUND).end();

    // 2) Statischer Bearer (Befund 2, E2): Telnyx sendet das Integration-Secret als
    // Authorization: Bearer <secret>, pro Turn identisch. Leerer config-Wert -> 403
    // (Empty-Secret-Trap, safeEqual("","")===true waere sonst die Falle, wie D3).
    const secret = config.telnyxShimSharedSecret;
    const bearer = bearerFrom(req.headers.authorization || "");
    if (!secret || !safeEqual(bearer, secret)) {
      logShimGate({
        reason: "auth",
        hasHeader: Boolean(req.headers.authorization),
        secretConfigured: Boolean(secret),
      });
      return res.status(HTTP_FORBIDDEN).end();
    }

    // 3) Korrelation (E1): Call aus der forward_metadata-call_control_id, NICHT aus dem
    // spoofbaren OpenAI-Body-callId. Kein Wert -> 403 (fail-closed, kein Token-Burn).
    const ccid = callControlIdFromForwardedMetadata(req.body);
    // OBS-FLAG (default aus): einmaliger keys-only Shape-Dump der Legacy-Positionen - seit
    // P1b-FIX ein Drift-Detektor (die Korrelation laeuft ueber extra_metadata). Feuert AUCH
    // auf dem Erfolgspfad. Erst NACH dem Bearer-Gate (kein Dump unauthentifizierter Bodies).
    // Rein additiv, keine Gate-Aenderung.
    if (config.telnyxShimDebugShape) logShimShape(forwardMetadataShape(req.body));
    if (!ccid) {
      logShimGate({
        reason: "no_ccid",
        bodyKeys: objectKeys(req.body),
        metadataKeys: objectKeys(req.body && req.body.metadata),
        extraMetadataKeys: objectKeys(req.body && req.body.extra_metadata),
      });
      return res.status(HTTP_FORBIDDEN).end();
    }

    // 4) Call-Resolve (lebende Store-Referenz, kein DTO): unbekannter oder nicht-aktiver
    // Call -> 403 (ein aufgelegter Call darf keine weiteren Token-Turns ausloesen).
    const call = store.getCallByControlId(ccid);
    if (!call || call.status !== "active") {
      logShimGate({ reason: "call_unresolved", found: Boolean(call), status: call ? call.status : null });
      return res.status(HTTP_FORBIDDEN).end();
    }

    const locale = localeFor(call.language);
    const model =
      typeof req.body?.model === "string" && req.body.model ? req.body.model : config.claudeModel;
    // OpenAI-spec-Modus (stab-p6): strikt stream===true -> SSE-Delta-Sequenz; sonst (false/
    // fehlend/nicht-boolean) -> plain chat.completion-JSON. Telnyx sendet live stream:true.
    const wantsStream = req.body?.stream === true;

    // 4.6) stab-p9 Loop-Guard + Dead-Air-Feed (Kosten-Notaus, ZUSAETZLICH zum Rate-Limiter):
    // Jeder aufgeloeste Turn fuettert den Dead-Air-Timer (Lebenszeichen) und fuehrt den
    // Leer-Turn-Streak fort. M konsekutive nicht-substanzielle Turns -> kontrollierte
    // Terminierung, VOR agentTurn (kein Token-Burn): Abschiedssatz ZUERST, dann realer
    // Hangup (Muster Budget-Gate, Schritt 6). Substanz = EINE Quelle mit stab-p7.
    // K0: observeTurn liefert zusaetzlich turnSeq (Shim-Request-Nummer dieses Calls) - rein
    // additiv, veraendert weder diese noch die nachfolgenden Gates (Rate-/Budget-Gate) an
    // Reihenfolge oder Verhalten. MINOR-1-Fix: turnSeq wird JETZT in JEDE Gate-Log-Zeile ab
    // hier (loop_guard/rate_limited/budget_*) UND in die agentTurn-Fehlerzeile durchgereicht,
    // nicht mehr nur in die turn_ok-Zeile - genau diese Terminierungspfade (Loop-Guard/Budget)
    // beenden den Call, ohne dass turn_ok je feuert; ohne die Ergaenzung ging der finale
    // Zaehlerstand fuer sie verloren (K0 ist die harte Vorbedingung fuer die spaetere Eager-
    // EOT-Kostensichtbarkeit, K8).
    const callerText = lastUserText(req.body);
    const { loopExceeded, turnSeq } = watchdog.observeTurn(call.id, callerText);
    if (loopExceeded) {
      logShimGate({ reason: "loop_guard", callId: call.id, turnSeq });
      writeCompletion(res, { model, content: locale.llmDegradedSpeech, stream: wantsStream });
      await terminateCall(call.id);
      return;
    }

    // 5) Rate-Gate (P5, Scope 4): N+1 Turns fuer denselben Call im Fenster -> definierte
    // Ablehnung OHNE agentTurn-Aufruf (kein Token-Burn). Gueltige Degradations-Completion
    // (Muster Budget-Gate unten), damit Telnyx den Turn nicht als abgebrochen/stumm liest.
    if (!shimRateHit(call.id).allowed) {
      logShimGate({ reason: "rate_limited", callId: call.id, turnSeq });
      return writeCompletion(res, { model, content: locale.llmDegradedSpeech, stream: wantsStream });
    }

    // 6) Budget-Gate (Invariante 3 / Regel 1, Token-Achse): kein agentTurn-Aufruf bei
    // Cap-Ueberschreitung (kein Token-Burn). P6 (Weg iii): Abschluss-Ansage ZUERST, DANN den
    // Call REAL auflegen - sonst deckt der Cap nur die Ansage, die Tokenkosten liefen weiter
    // (Regel 1 verlangt BEIDE Achsen). terminateCall ist fail-safe (kein callControlId ->
    // Skip + Log, eigener try/catch, secret-frei) - dasselbe GETEILTE Primitiv wie der
    // Loop-Guard (Schritt 4.6) und der end_call-Hangup (Schritt 8, G5). Settlement bleibt
    // P4.5 onHangup (EIN idempotenter Pfad ueber den ausgeloesten call.hangup-Event).
    const tenantBudgetOver = store.budgetExceeded(call.tenantId, config);
    const globalBudgetOver = !tenantBudgetOver && store.globalBudgetExceeded(config);
    if (tenantBudgetOver || globalBudgetOver) {
      logShimGate({
        reason: tenantBudgetOver ? "budget_tenant" : "budget_global",
        callId: call.id,
        tenantId: call.tenantId,
        turnSeq,
      });
      writeCompletion(res, { model, content: locale.budgetExhaustedHangup, stream: wantsStream });
      await terminateCall(call.id);
      return;
    }

    // 7) Kern: agentTurn (in-house Tool-Loop) gegen die per Call-Control-ID gebundene,
    // frische call-Referenz.
    let endCall = false;
    let farewellChars = 0; // afix-p3: Basis der Sprechdauer-Schaetzung (Schritt 8)
    try {
      const startedAt = Date.now();
      const turn = await agentTurn(call, callerText);
      const latencyMs = Date.now() - startedAt;
      // EIN latencyMs-Wert, zwei Senken: der opt-in metrics-Seam (P10, hinter metricsEnabled,
      // NICHT TTFT sondern Gesamt-Turn) UND das UNCONDITIONAL OBS-1-Betriebssignal (im Vorfall
      // war metricsEnabled AUS = kein Lebenszeichen). Bewusst getrennte Kanaele/Prefixe.
      metrics.logShimTurn({ callId: call.id, latencyMs });
      logShimTurnOk({ callId: call.id, latencyMs, turnSeq });
      // P5 (OBS/R6): unter demselben default-off TELNYX_SHIM_DEBUG_SHAPE-Flag und demselben
      // shape-Kanal (logShimShape) eine PII-freie Zeile, die den eingehenden messages-Payload
      // mit speechEmpty verknuepft - trennt "Brain lieferte leeren Text" von "Vendor sprach
      // nicht" (§2.2). Nur auf dem Erfolgspfad (es gibt ein Turn-Ergebnis); reine Diagnose,
      // messagesTurnShape ist wurf-frei und darf die bereits erfolgreiche Turn-Response nicht
      // in den Catch reissen.
      if (config.telnyxShimDebugShape) logShimShape(messagesTurnShape(req.body, turn));
      endCall = turn.endCall === true;
      farewellChars = speechTextOf(turn).length;
      writeCompletion(res, { model, content: turn.speech, stream: wantsStream }); // Abschiedssatz geht ZUERST raus
    } catch (err) {
      // P2 (Resilienz-Bruecke): NIE roher 5xx/leerer Hang - Telnyx liest den als
      // abgebrochenen/stummen Turn. Stattdessen dieselbe Zwei-Klassen-Degradation wie
      // der /voice/turn-Catch (server.js) - degradedSpeechFor (llm.js, G5: EINE Quelle
      // statt zweifach dupliziertem Ternary): transient-erschoepft (LlmUnavailableError -
      // Breaker offen ODER Retries erschoepft) -> llmDegradedSpeech; jeder ANDERE Fehler
      // (nicht-transient, z.B. 4xx/Auth) -> turnErrorSpeech. Der Fehler wird weiter
      // geloggt (nur err.name, secret-frei), nur die Antwort ist eine gueltige Completion.
      // KEIN Retry hier (der llm.js-Seam hat bereits begrenzt+selektiv retried).
      console.error(`${SHIM_LOG_PREFIX} agentTurn fehlgeschlagen (turnSeq=${turnSeq}):`, err && err.name); // secret-frei
      if (vendorStatusOf(err) === HTTP_PAYMENT_REQUIRED)
        logShimGate({ reason: "vendor_402", callId: call.id, turnSeq });
      const content = degradedSpeechFor(err, locale);
      // Dieser Catch faengt AUCH Fehler aus writeCompletion selbst (kein eigener
      // try/catch dort): wirft der Happy-Path-writeCompletion NACH einem Teil-Write
      // (z.B. Socket bricht zwischen den SSE-res.write-Aufrufen weg), ist
      // headersSent bereits true - ein zweiter writeCompletion-Versuch wuerde erneut
      // in denselben kaputten Stream schreiben. Stattdessen nur end() (bestmoegliches
      // Aufraeumen); der Client sieht einen abgebrochenen Stream statt einer zweiten,
      // ueberlappenden Antwort. Regressionstest: T1 in telnyx-llm-shim.test.js.
      if (!res.headersSent) writeCompletion(res, { model, content, stream: wantsStream });
      else res.end();
      // KEIN return hier (G3/T5): agentTurn kann VOR diesem Fehler bereits erfolgreich
      // endCall=true geliefert haben - der Fehler stammt dann aus writeCompletion selbst
      // (Zeile oben, exakt das T1-Szenario), NICHT aus agentTurn. Schritt 8 unten muss den
      // Hangup trotzdem versuchen, sonst laeuft der Call trotz bereits gegebenem
      // Abschiedssignal auf Tokenkosten weiter (Regel 1). Wirft dagegen agentTurn selbst,
      // bleibt endCall auf dem Default false - Schritt 8 ist dann ein No-op.
    }

    // 8) end_call (afix-p3, Wurzel R4): der Abschiedssatz ist als Completion raus - die TTS-
    // Synthese/Wiedergabe laeuft aber erst an. Frueher terminierte der Shim hier SOFORT (Live
    // gemessen: Hangup 81 ms nach der Completion) und schnitt den Abschied ab. Jetzt uebergibt er
    // die Terminierung an den Watchdog, der ALLE Timer dieses Calls besitzt: er verzoegert um die
    // geschaetzte Sprechdauer (gedeckelt) und suspendiert waehrenddessen seine Dead-Air-Achse.
    // Ein externer call.hangup (onHangup -> watchdog.clear) oder ein neuer Turn (observeTurn)
    // blasen die Terminierung ab -> genau EIN Terminate pro Call. Die Notaus-Pfade (Loop-Guard
    // Schritt 4.6, Budget-Kill Schritt 6) bleiben SOFORTIG: dort gibt es keinen Abschied zu
    // schuetzen, nur Kosten zu stoppen (Regel 1).
    if (endCall) {
      // MAJOR-1-Fix (K3, PLAN-CONVERSATION-OPTIMIZATION.md): call.language reicht die
      // sprachabhaengige Farewell-Kalibrierung durch (watchdog-Tabelle: NUR 'de' vermessen,
      // sonst Fallback = altes Verhalten). Ohne dieses Feld haette JEDER Call die de-
      // Kalibrierung bekommen - fuer en/fr zu knapp geschaetzt, genau R4.
      const { delayMs } = watchdog.scheduleFarewellHangup(call.id, {
        speechChars: farewellChars,
        language: call.language,
      });
      logShimFarewell({ callId: call.id, delayMs, turnSeq });
    }
  };
}

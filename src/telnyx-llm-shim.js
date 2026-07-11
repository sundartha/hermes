// Brain-Shim (PLAN-TELNYX-AI-ASSISTANT.md, Phase P1): in-house /v1/chat/completions-
// kompatibler Endpunkt. Kapselt agentTurn (claude.js) und framt die Antwort als
// Fake-Stream (1 SSE-Chunk + data: [DONE]). Bei C-Telnyx UND C-ElevenLabs identisch.
// Existenz fail-closed hinter TELNYX_AI_ASSISTANT_ENABLED (404 bis Cutover); Auth ueber
// ein statisches Telnyx-Integration-Secret (E2) + call_control_id-Korrelation (E1).
// KEINE Safety-Gate-Umgehung, KEINE llm.js-Aenderung, KEIN Direktimport von execTool/
// toolDefs (agentTurn ruft sie in-house auf -> S2-Anti-Duplizierung).
import { randomUUID } from "node:crypto";
import { safeEqual } from "./util.js";
import { degradedSpeechFor } from "./llm.js";
import { makeFixedWindowCounter } from "./middleware.js";
import { metrics as defaultMetrics } from "./metrics.js";

// OpenAI-SSE-Konstanten (G25, keine Magic-Strings gestreut):
const OPENAI_CHUNK_OBJECT = "chat.completion.chunk";
const CHAT_COMPLETION_ID_PREFIX = "chatcmpl-";
const FINISH_STOP = "stop";
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
function messagesTurnShape(body, turn) {
  const messages = messagesArray(body);
  const { contentType, length } = lastUserContentShape(messages);
  const speech = turn && typeof turn.speech === "string" ? turn.speech : "";
  return {
    messagesCount: messages.length,
    roleCounts: roleCounts(messages),
    lastUserContentType: contentType,
    lastUserLength: length,
    lastUserTextPresent: lastUserText(body).trim().length > 0,
    speechEmpty: speech.length === 0,
  };
}

// Framt EINEN OpenAI chat.completion.chunk + data:[DONE] (G5: EINE Quelle fuer
// Budget-Wind-Down UND agentTurn-Ergebnis). Setzt Content-Type text/event-stream.
function writeFakeStream(res, { model, content }) {
  res.setHeader("Content-Type", "text/event-stream");
  const chunk = {
    id: CHAT_COMPLETION_ID_PREFIX + randomUUID(),
    object: OPENAI_CHUNK_OBJECT,
    created: Math.floor(Date.now() / MS_PER_SECOND),
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: FINISH_STOP }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.write(SSE_DONE);
  res.end();
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
// call.id + latencyMs (PII-frei), separater Kanal/Prefix als der opt-in metrics-Seam.
function logShimTurnOk(payload) {
  console.log(formatShimLine("turn_ok", payload));
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

  // P3a (Regel 1 / Befund 6): end_call MUSS den Call REAL beenden. Anders als in der
  // Budget-Engine (dort rendert der Server hangupD aus {speech,endCall}) gibt es bei
  // C-Telnyx keinen Text-Rueckkanal "leg auf" - ohne echten Hangup laeuft der Call plus
  // Tokenkosten weiter. Terminierung out-of-band ueber Call-Control; KEIN zweiter Store-
  // Write (Settlement kommt ueber den call.hangup-Event -> P4.5 onHangup, EIN idempotenter
  // Pfad ueber billedAt/reserveReleased). P6 nutzt denselben Helper fuer den Mid-Call-
  // Budget-Kill (zweiter Aufrufer, G5).
  async function terminateViaCallControl(call) {
    // Frischer Store-Stand (Pre-Mortem): callControlId kann waehrend des Turns gesetzt
    // worden sein - nicht auf den Turn-Anfang-Stand vertrauen (Muster P4.5 onHangup).
    const fresh = store.getCall(call.id);
    const callControlId = fresh && fresh.callControlId;
    if (!callControlId) {
      // fail-safe: callControlId persistiert erst P5 (Origination). Fehlt sie -> Skip + Log,
      // KEIN Crash/Orphan (die Response ist bereits raus), Muster P4.5 assistantId-Handling.
      console.warn(`${SHIM_LOG_PREFIX} Hangup ohne callControlId (call=${call.id}) -> kein Hangup`);
      return;
    }
    try {
      // Eigener try/catch: ein Hangup-Fehler darf die BEREITS gesendete Response nicht
      // nachtraeglich zerstoeren; nur secret-frei loggen (err.name, Muster P4.5 onHangup).
      await voiceControl(call.provider).endCallViaCallControl(callControlId);
    } catch (err) {
      console.error(`${SHIM_LOG_PREFIX} Call-Control-Hangup fehlgeschlagen:`, err && err.name);
    }
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

    // 5) Rate-Gate (P5, Scope 4): N+1 Turns fuer denselben Call im Fenster -> definierte
    // Ablehnung OHNE agentTurn-Aufruf (kein Token-Burn). Gueltige Degradations-Completion
    // (Muster Budget-Gate unten), damit Telnyx den Turn nicht als abgebrochen/stumm liest.
    if (!shimRateHit(call.id).allowed) {
      logShimGate({ reason: "rate_limited", callId: call.id });
      return writeFakeStream(res, { model, content: locale.llmDegradedSpeech });
    }

    // 6) Budget-Gate (Invariante 3 / Regel 1, Token-Achse): kein agentTurn-Aufruf bei
    // Cap-Ueberschreitung (kein Token-Burn). P6 (Weg iii): Abschluss-Ansage ZUERST, DANN den
    // Call REAL auflegen - sonst deckt der Cap nur die Ansage, die Tokenkosten liefen weiter
    // (Regel 1 verlangt BEIDE Achsen). terminateViaCallControl ist fail-safe (kein
    // callControlId -> Skip + Log, eigener try/catch, secret-frei) - identisches Muster wie der
    // end_call-Hangup (Schritt 8, G5: EIN Helper). Settlement bleibt P4.5 onHangup (EIN
    // idempotenter Pfad ueber den ausgeloesten call.hangup-Event).
    const tenantBudgetOver = store.budgetExceeded(call.tenantId, config);
    const globalBudgetOver = !tenantBudgetOver && store.globalBudgetExceeded(config);
    if (tenantBudgetOver || globalBudgetOver) {
      logShimGate({
        reason: tenantBudgetOver ? "budget_tenant" : "budget_global",
        callId: call.id,
        tenantId: call.tenantId,
      });
      writeFakeStream(res, { model, content: locale.budgetExhaustedHangup });
      await terminateViaCallControl(call);
      return;
    }

    // 7) Kern: agentTurn (in-house Tool-Loop) gegen die per Call-Control-ID gebundene,
    // frische call-Referenz.
    let endCall = false;
    try {
      const startedAt = Date.now();
      const turn = await agentTurn(call, lastUserText(req.body));
      const latencyMs = Date.now() - startedAt;
      // EIN latencyMs-Wert, zwei Senken: der opt-in metrics-Seam (P10, hinter metricsEnabled,
      // NICHT TTFT sondern Gesamt-Turn) UND das UNCONDITIONAL OBS-1-Betriebssignal (im Vorfall
      // war metricsEnabled AUS = kein Lebenszeichen). Bewusst getrennte Kanaele/Prefixe.
      metrics.logShimTurn({ callId: call.id, latencyMs });
      logShimTurnOk({ callId: call.id, latencyMs });
      // P5 (OBS/R6): unter demselben default-off TELNYX_SHIM_DEBUG_SHAPE-Flag und demselben
      // shape-Kanal (logShimShape) eine PII-freie Zeile, die den eingehenden messages-Payload
      // mit speechEmpty verknuepft - trennt "Brain lieferte leeren Text" von "Vendor sprach
      // nicht" (§2.2). Nur auf dem Erfolgspfad (es gibt ein Turn-Ergebnis); reine Diagnose,
      // messagesTurnShape ist wurf-frei und darf die bereits erfolgreiche Turn-Response nicht
      // in den Catch reissen.
      if (config.telnyxShimDebugShape) logShimShape(messagesTurnShape(req.body, turn));
      endCall = turn.endCall === true;
      writeFakeStream(res, { model, content: turn.speech }); // Abschiedssatz geht ZUERST raus
    } catch (err) {
      // P2 (Resilienz-Bruecke): NIE roher 5xx/leerer Hang - Telnyx liest den als
      // abgebrochenen/stummen Turn. Stattdessen dieselbe Zwei-Klassen-Degradation wie
      // der /voice/turn-Catch (server.js) - degradedSpeechFor (llm.js, G5: EINE Quelle
      // statt zweifach dupliziertem Ternary): transient-erschoepft (LlmUnavailableError -
      // Breaker offen ODER Retries erschoepft) -> llmDegradedSpeech; jeder ANDERE Fehler
      // (nicht-transient, z.B. 4xx/Auth) -> turnErrorSpeech. Der Fehler wird weiter
      // geloggt (nur err.name, secret-frei), nur die Antwort ist eine gueltige Completion.
      // KEIN Retry hier (der llm.js-Seam hat bereits begrenzt+selektiv retried).
      console.error(`${SHIM_LOG_PREFIX} agentTurn fehlgeschlagen:`, err && err.name); // secret-frei
      if (vendorStatusOf(err) === HTTP_PAYMENT_REQUIRED)
        logShimGate({ reason: "vendor_402", callId: call.id });
      const content = degradedSpeechFor(err, locale);
      // Dieser Catch faengt AUCH Fehler aus writeFakeStream selbst (kein eigener
      // try/catch dort): wirft der Happy-Path-writeFakeStream NACH einem Teil-Write
      // (z.B. Socket bricht zwischen den beiden res.write-Aufrufen weg), ist
      // headersSent bereits true - ein zweiter writeFakeStream-Versuch wuerde erneut
      // in denselben kaputten Stream schreiben. Stattdessen nur end() (bestmoegliches
      // Aufraeumen); der Client sieht einen abgebrochenen Stream statt einer zweiten,
      // ueberlappenden Antwort. Regressionstest: T1 in telnyx-llm-shim.test.js.
      if (!res.headersSent) writeFakeStream(res, { model, content });
      else res.end();
      // KEIN return hier (G3/T5): agentTurn kann VOR diesem Fehler bereits erfolgreich
      // endCall=true geliefert haben - der Fehler stammt dann aus writeFakeStream selbst
      // (Zeile oben, exakt das T1-Szenario), NICHT aus agentTurn. Schritt 8 unten muss den
      // Hangup trotzdem versuchen, sonst laeuft der Call trotz bereits gegebenem
      // Abschiedssignal auf Tokenkosten weiter (Regel 1). Wirft dagegen agentTurn selbst,
      // bleibt endCall auf dem Default false - Schritt 8 ist dann ein No-op.
    }

    // 8) end_call (P3a, Regel 1): der Abschiedssatz ist raus (oder bestmoeglich degradiert);
    // jetzt den Call out-of-band REAL beenden, falls agentTurn end_call lieferte - unabhaengig
    // davon, ob der nachfolgende Response-Write selbst noch erfolgreich war (siehe Kommentar
    // oben). Reihenfolge ist Absicht - speech ZUERST, Hangup danach (P11-Live-Kriterium: ob
    // der Call-Control-Hangup gepuffertes TTS abschneidet, ist live UNBESTAETIGT, wie P4/P4.5).
    if (endCall) await terminateViaCallControl(call);
  };
}

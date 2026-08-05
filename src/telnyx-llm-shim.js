// Brain-Shim (PLAN-TELNYX-AI-ASSISTANT.md): in-house /v1/chat/completions-
// kompatibler Endpunkt. Kapselt agentTurn (claude.js) und framt die Antwort OpenAI-spec-
// konform: stream:true -> SSE-Delta-Sequenz (role-Chunk, ein oder mehrere content-Chunks,
// separater finish-Chunk, data:[DONE]); stream:false/fehlend -> plain chat.completion-JSON.
// Modus wird per-Request aus req.body.stream ausgehandelt. WIE VIELE content-Chunks es
// gibt, entscheidet AL-P7 (TELNYX_SHIM_TOKEN_STREAMING): aus -> genau einer am Turn-Ende
// wie im Bestand, an -> je fertigem Satz einer, sofort. Bei C-Telnyx UND C-ElevenLabs identisch.
// Existenz fail-closed hinter TELNYX_AI_ASSISTANT_ENABLED (404 bis Cutover); Auth ueber
// ein statisches Telnyx-Integration-Secret (E2) + call_control_id-Korrelation (E1).
// KEINE Safety-Gate-Umgehung, KEINE llm.js-Aenderung, KEIN Direktimport von execTool/
// toolDefs (agentTurn ruft sie in-house auf -> S2-Anti-Duplizierung).
import { randomUUID } from "node:crypto";
import { safeEqual, hashText } from "./util.js";
import { degradedSpeechFor, isProviderBillingError } from "./llm.js";
import { makeFixedWindowCounter } from "./middleware.js";
import { metrics as defaultMetrics } from "./metrics.js";
import { makeCallControlTerminator } from "./telnyx-call-terminate.js";
import { blockingBudgetAxis, isBudgetAxis } from "./budget-gate.js";
import {
  consultAnswerAwaitingDelivery,
  consultClientIsPolling,
  consultPollAgeMs,
} from "./consult/in-call.js";
import { makeTurnTextProbe, TURN_TEXT_RELATION } from "./telnyx-turn-probe.js";
import { makeInFlightTurnRegistry } from "./telnyx-turn-supersede.js";
import { makeConsecutiveFailureCounter } from "./telnyx-turn-failures.js";

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

// Die drei OpenAI-Rollen, die der Shim kennt; jede andere/fehlende faellt auf "other"
// (bounded - kein angreiferkontrollierter Rollen-String geraet je in den Log). EINE Quelle
// (G5) fuer roleCounts UND lastMessageRole.
// GQ-P5: eigene Konstante, weil "system" ab jetzt nicht mehr nur Log-Stoff ist, sondern
// die Entscheidungsgrundlage des Provider-Anstoss-Riegels (Schritt 6.5) - EINE Quelle (G5)
// fuer die Rollen-Liste UND den Vergleich.
const MESSAGE_ROLE_SYSTEM = "system";
const KNOWN_MESSAGE_ROLES = Object.freeze([MESSAGE_ROLE_SYSTEM, "user", "assistant"]);
const OTHER_ROLE = "other";
const MISSING_ROLE = "missing"; // leeres messages-Array (Konvention wie lastUserContentShape)

function boundedRole(message) {
  const role = message && message.role;
  return KNOWN_MESSAGE_ROLES.includes(role) ? role : OTHER_ROLE;
}

// Nachrichten je bekannter Rolle; unbekannte/fehlende Rollen -> "other" (bounded, damit
// kein angreiferkontrollierter Rollen-String in den Log geraet).
function roleCounts(messages) {
  const counts = { system: 0, user: 0, assistant: 0, other: 0 };
  for (const m of messages) counts[boundedRole(m)] += 1;
  return counts;
}

// GQ-S1 Sonde A: Rolle der LETZTEN Nachricht des Payloads (nicht der letzten user-
// Nachricht). Sie trennt "derselbe Request kam erneut" von "der Verlauf ist
// fortgeschrieben".
function lastMessageRole(messages) {
  return messages.length ? boundedRole(messages[messages.length - 1]) : MISSING_ROLE;
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
// Genutzt von der PII-freien Shape-Diagnose (speechEmpty) UND als Basis der
// Sprechdauer-Schaetzung - vorher stand dieser Guard inline in messagesTurnShape.
function speechTextOf(turn) {
  return turn && typeof turn.speech === "string" ? turn.speech : "";
}

// EIN Praedikat fuer den §2.2-Diskriminator, genutzt von der Shape-Diagnose UND der
// unconditional turn_ok-Zeile (G5, statt zweimal .length === 0).
function speechEmptyOf(turn) {
  return speechTextOf(turn).length === 0;
}

// AL-P1: die vier PII-freien Turn-Fakten der unconditional turn_ok-Zeile. Warum NICHT in
// den metrics-Seam: metrics.logTurn/logSpeechResult stehen hinter metricsEnabled
// (Fallback false) und speechEmpty existierte nur hinter TELNYX_SHIM_DEBUG_SHAPE - beide
// Signale waren im Prod-Log stumm, genau darauf stehen aber die Abnahmen von Phase 3
// (Truncation) und 4 (leeres speech). Fail-safe gegen jede Turn-Form (auch Test-Spies
// ohne die neuen Felder): roundtrips nur als Ganzzahl, sonst null; toolNames nur als
// Array, sonst []. NIE Text - chars ist eine Laenge, toolNames sind Werkzeugnamen.
function turnDiagnostics(turn, callerText) {
  return {
    roundtrips: Number.isSafeInteger(turn?.roundtrips) ? turn.roundtrips : null,
    toolNames: Array.isArray(turn?.toolNames) ? turn.toolNames : [],
    chars: callerText.length,
    speechEmpty: speechEmptyOf(turn),
    // AL-P7b: hat dieser Turn die Wartezeit ueberbrueckt? Ein Boolean, kein Text - die
    // PII-Freiheit der Zeile bleibt unberuehrt. Ohne diese Spalte waere am Live-Log nicht
    // unterscheidbar, ob ein Chunk die Ueberbrueckung oder die Antwort war; genau darauf
    // stehen die Abnahmen 2 und 6 dieser Phase.
    thinkingSignal: turn?.thinkingSignalSpoken === true,
    // AL-D1: der dem Modell ANGEBOTENE Werkzeugsatz dieses Turns. NAMEN, also dieselbe
    // PII-Klasse wie toolNames. Fail-safe wie dort: nur ein Array, sonst [].
    offeredToolNames: Array.isArray(turn?.offeredToolNames) ? turn.offeredToolNames : [],
    // AL-D1: in wie vielen Runden der Streaming-Pfad armiert war. Fail-safe wie
    // roundtrips: nur eine Ganzzahl, sonst null.
    streamArmedRounds: Number.isSafeInteger(turn?.streamArmedRounds)
      ? turn.streamArmedRounds
      : null,
  };
}

function messagesTurnShape(body, turn) {
  const messages = messagesArray(body);
  const { contentType, length } = lastUserContentShape(messages);
  return {
    messagesCount: messages.length,
    roleCounts: roleCounts(messages),
    lastUserContentType: contentType,
    lastUserLength: length,
    lastUserTextPresent: lastUserText(body).trim().length > 0,
    speechEmpty: speechEmptyOf(turn),
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

// AL-P7: EINE Antwort als offener SSE-Strom. Haelt genau den Zustand, den der Turn kennen
// muss - ist schon Inhalt auf der Leitung, und ist der Strom bereits abgeschlossen.
// id/created bleiben ueber alle Chunks EINER Antwort stabil (OpenAI-Verhalten).
function makeStreamingResponse(res, model) {
  const envelope = completionEnvelope(model);
  let opened = false;
  let chunks = 0;
  let finished = false;
  // Ein Write ist gerissen (Socket weg). Der Strom ist dauerhaft kaputt - kein spaeterer
  // Pfad darf erneut in ihn hineinschreiben; der Client saehe sonst eine zweite,
  // ueberlappende Antwort im selben Body (Regressionstest T1, telnyx-llm-shim.test.js).
  let broken = false;
  function guardWrite(write) {
    try {
      write();
    } catch (err) {
      broken = true;
      throw err;
    }
  }
  const emit = (payload) => guardWrite(() => writeSseEvent(res, payload));
  function open() {
    if (opened) return;
    opened = true;
    res.setHeader("Content-Type", SSE_CONTENT_TYPE);
    emit(streamChunk(envelope, { role: ASSISTANT_ROLE }, null));
  }
  return {
    // Ein sprechbares Fragment SOFORT auf die Leitung (der Latenzgewinn dieser Phase).
    writeChunk(text) {
      open();
      emit(streamChunk(envelope, { content: text }, null));
      chunks += 1;
    },
    // Optionaler letzter Chunk, dann finish_reason + [DONE] + end. Einmalig; auf einem
    // bereits gerissenen Strom bleibt nur end() (bestmoegliches Aufraeumen, T1).
    finish(tailText) {
      if (finished) return;
      finished = true;
      if (broken) return void res.end();
      open();
      if (tailText) emit(streamChunk(envelope, { content: tailText }, null));
      emit(streamChunk(envelope, {}, FINISH_STOP));
      guardWrite(() => res.write(SSE_DONE));
      res.end();
    },
    chunkCount: () => chunks,
    isFinished: () => finished,
  };
}

// stream:true -> OpenAI-spec-konforme SSE-Sequenz in EINEM Zug (Bestandskadenz):
// role-Delta-Chunk, dann content-Delta-Chunk, dann SEPARATER finish_reason-Chunk
// (delta:{}), dann data:[DONE]. Der Turn-TEXT bleibt unveraendert - nur die Draht-
// Repraesentation wird spec-konform.
function writeStreamingCompletion(res, { model, content }) {
  makeStreamingResponse(res, model).finish(content);
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

// Der Hangup ist geplant, nicht ausgefuehrt - ohne diese Zeile waere im Live-Log
// nicht unterscheidbar, ob end_call gefallen ist. callId + delayMs + turnSeq (MINOR-1-Fix, 2.
// Review-Runde: turnSeq dokumentiert, nach wie vielen Turns der Call den Abschied ausgeloest
// hat - PII-frei, kein Text).
function logShimFarewell(payload) {
  console.log(formatShimLine("farewell_scheduled", payload));
}

// KS-P1b: ein re-attachter Call ist ein BETRIEBS-Ereignis, kein Gate - eigener Kanal
// (kind="reattached", console.log wie turn_ok, nicht warn). Ohne diese Zeile bliebe in den
// Render-Logs unsichtbar, dass ein Deploy-/Instanzwechsel ein laufendes Assistant-Gespraech
// getroffen hat - genau der Vorfall, den KS-P1 nur durch Codelesen belegen konnte. Nur die
// server-generierte callId (PII-frei), NIE die call_control_id.
function logShimReattach(payload) {
  console.log(formatShimLine("reattached", payload));
}

// GQ-S1 Sonde A (B-1): eine PII-freie Zeile JE Shim-Request, eigener Kanal (kind=
// "turn_probe"), console.log wie turn_ok. Sie beantwortet genau eine Frage: sind zwei POSTs
// fuer dieselbe Aeusserung zwei Sprech-Turns oder EIN doppelt zugestellter Request. Nur
// Laengen, Hashes, Namen, Zeitstempel - NIE Wortlaut, NIE Rufnummern, NIE Header-Werte.
function logShimTurnProbe(payload) {
  console.log(formatShimLine("turn_probe", payload));
}

// GQ-P1 (Befund B-1): die Entscheidung des Riegels als eigener Kanal (kind="supersede"),
// console.log wie turn_probe. PII-frei: callId, turnSeq, ein Boolean, ein Grund-Token -
// nie Wortlaut, nie Rufnummern. Diese Zeile IST das Messinstrument der Abnahme: sie trennt
// "verdraengt" von "nicht verdraengt, weil der Vorgaenger-Turn schon fertig war"
// (no_inflight) und von "sein Text war schon auf der Leitung" (already_spoken). Ohne sie
// waere am naechsten Testanruf nicht entscheidbar, ob der Riegel greift oder ins Leere
// laeuft - genau die Frage, die diese Phase offen laesst.
function logShimSupersede(payload) {
  console.log(formatShimLine("supersede", payload));
}

// Nur von Telnyx gesetzte Anfrage-Header (Allowlist-Praefix), Name -> nicht umkehrbarer
// Hash des Wertes. Der WERT wird nie geloggt: identische Hashes belegen "derselbe Request",
// ohne dass ein zufaellig mitgefuehrtes Geheimnis (z.B. ein Signatur-Header) je im Log
// steht. authorization ist durch die Praefix-Allowlist strukturell ausgeschlossen.
const TELNYX_HEADER_PREFIX = "x-telnyx-";

function telnyxHeaderFingerprints(headers) {
  const fingerprints = {};
  for (const name of Object.keys(headers || {}).sort())
    if (name.toLowerCase().startsWith(TELNYX_HEADER_PREFIX))
      fingerprints[name] = hashText(headers[name]);
  return fingerprints;
}

// Die Request-Fakten der Sonde: wie viele Nachrichten, welche Rolle zuletzt, welche
// Telnyx-Header. Reine Form, keine Inhalte.
function requestOriginShape(req) {
  const messages = messagesArray(req.body);
  return {
    messagesCount: messages.length,
    lastRole: lastMessageRole(messages),
    telnyxHeaders: telnyxHeaderFingerprints(req.headers),
  };
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

// GQ-P4/A4 (Owner-Entscheidung 2026-08-04): der Bezahl-/Guthaben-Fall ist KEIN
// gewoehnlicher Turn-Fehler - er legt den Agenten fuer JEDEN Anruf gleichzeitig still.
// Eigener, eindeutig greppbarer Kanal (console.error, Token ALARM_LLM_BILLING) und die
// HANDLUNG im Payload: eine Zeile, die nur "Fehler" sagt, hat den Vorfall am 04.08. genau
// nicht sichtbar gemacht (P8). BEWUSST KEINE Alarm-SMS - sie kostet Geld und kann in eine
// Schleife geraten; die Alarmregel haengt der Betreiber ausserhalb des Repos an dieses Token.
// PII-frei: nur callId/turnSeq/Zaehler + ein fester deutscher Handlungstext.
const BILLING_ALARM_ACTION =
  "KI-Guthaben beim Anbieter aufgebraucht - sofort aufladen, sonst antwortet KEIN Anruf mehr";

function logShimBillingAlarm(payload) {
  console.error(formatShimLine("ALARM_LLM_BILLING", { ...payload, handlung: BILLING_ALARM_ACTION }));
}

// GQ-P4/A3 - MESSPUNKT, kein Fix. Der Degradations-Satz ist im Catch verdrahtet, trotzdem
// hoerte der Owner ueber sieben gescheiterte Turns hinweg nichts. Ob der Satz gar nicht auf
// den Draht ging oder nur nicht gesprochen wurde, war ungemessen. Diese Zeile beantwortet
// die erste Haelfte deterministisch: WELCHER der drei Sendewege lief und WIE VIELE Zeichen
// ihn verlassen haben. Zeichenzahl, NIE Wortlaut.
function logShimDegraded(payload) {
  console.warn(formatShimLine("degraded", payload));
}

// Die drei Sendewege der Degradation (G25: benannte Token statt gestreuter Strings - die
// Log-Auswertung greift genau diese Werte ab).
const DEGRADED_PATH = Object.freeze({
  STREAM_TAIL: "stream_tail",           // offener SSE-Strom -> Satz als LETZTER Chunk
  FRESH_COMPLETION: "fresh_completion", // noch nichts geschrieben -> frische Completion
  WIRE_LOST: "wire_lost",               // Strom fertig/gerissen -> nur end(), NULL Zeichen
});

export function makeTelnyxLlmShim({
  store,
  config,
  agentTurn,
  localeFor,
  voiceControl,
  watchdog,
  // KS-P1b: lifecycle.reattachActiveCallByControlId (die EINE Wurzel-Instanz). Bewusst OHNE
  // Default - ein stiller No-op-Fallback waere genau die abgeschaltete Sicherung, die hier
  // verboten ist.
  reattachActiveCallByControlId,
  metrics = defaultMetrics,
}) {
  // P5 (Scope 4, Carryover aus P4): per-callId-Fixed-Window - Toll-/Token-Fraud-Bremse
  // VOR agentTurn, zusaetzlich zum globalen Per-IP-Limiter + Budget-Cap. EINE Quelle
  // (makeFixedWindowCounter, G5) statt einer zweiten Zaehler-Implementierung hier.
  const shimRateHit = makeFixedWindowCounter({
    windowMs: SHIM_RATE_WINDOW_MS,
    limit: config.telnyx.telnyxAssistant.shimMaxTurnsPerMin,
    sweepMs: SHIM_RATE_SWEEP_MS,
  });

  // GQ-S1 Sonde A: EINE Instanz je Shim (kein Modul-Zustand, kein Lazy-Init - P15). Haelt
  // je Call nur {atMs, chars, hash} des letzten Turns, nie Text.
  const observeTurnText = makeTurnTextProbe();

  // GQ-P1: EINE Instanz je Shim (kein Modul-Zustand, kein Lazy-Init - P15), wie die Sonde
  // daneben. Haelt je Call nur das Abbruch-Signal des laufenden Turns, nie Text.
  const inFlightTurns = makeInFlightTurnRegistry();

  // GQ-P4/A2: EINE Instanz je Shim (kein Modul-Zustand, kein Lazy-Init - P15), wie die
  // Sonde und der Riegel daneben. Haelt je Call nur eine Zahl, nie Text.
  const { countFailedTurn, clearFailedTurns } = makeConsecutiveFailureCounter();

  // GQ-P4/A2: der Abschiedssatz bei anhaltendem Ausfall. Default kommt SPRACHABHAENGIG aus
  // dem Locale-Bundle (korrekte Umlaute je Sprache); ein gesetzter Config-Wert ueberschreibt
  // ihn fuer JEDE Sprache (dokumentierte Betreiber-Entscheidung, .env.example). Rein.
  function farewellSpeechFor(locale) {
    return config.telnyx.telnyxAssistant.failedTurnFarewellText || locale.llmGiveUpFarewell;
  }

  // Fail-safe Call-Control-Hangup ueber das GETEILTE Primitiv (S2/G5, auch der
  // Dead-Air-Watchdog nutzt es). Byte-identisches Verhalten/Log wie zuvor (SHIM_LOG_PREFIX).
  const terminateViaCallControl = makeCallControlTerminator({ store, voiceControl, logPrefix: SHIM_LOG_PREFIX });

  // Jede shim-getriebene Terminierung MUSS den
  // Dead-Air-Timer SOFORT loeschen. observeTurn (Schritt 4.6) armiert den Timer auf JEDEM
  // Turn VOR allen drei Gates - im Moment der Terminierung ist er also immer frisch
  // gestellt. Das Loeschen passiert sonst NUR verzoegert ueber den spaeter eintreffenden
  // call.hangup-Webhook (onHangup ruft dort watchdog.clear); bleibt dieser aus oder kommt
  // er zu spaet, feuert der Timer fuer einen bereits (aus anderem Grund) beendeten Call
  // erneut: zweiter Hangup-Versuch PLUS ein irrefuehrendes dead_air-Log. Ein Aufruf
  // erledigt Hangup+Clear zusammen (G5) - kein Aufrufer kann das Clear vergessen. Genutzt
  // vom Loop-Guard (Schritt 4.6) und Mid-Call-Budget-Kill (Schritt 6, P6) - beides Notaus-
  // Pfade, die SOFORT terminieren. end_call (Schritt 8) terminiert NICHT mehr
  // hierueber, sondern verzoegert ueber watchdog.scheduleFarewellHangup (Schutz des
  // Abschiedssatzes, R4). KEIN Store-Write - Settlement bleibt P4.5 onHangup.
  async function terminateCall(callId) {
    await terminateViaCallControl(callId);
    watchdog.clear(callId);
  }

  // KS-P1b: die Call-Aufloesung des Shims - Spiegel zuerst, bei Miss derselbe Re-Attach-Seam
  // wie /voice/turn|outbound|status und der Call-Control-Ingest (G5). Spiegel-Treffer =
  // byte-identisch zum Bestand (kein DB-Roundtrip, kein Verhaltensunterschied). Nur der Miss
  // laedt RLS-sauber nach, inkl. Restzeit-Klassifikation, Guthaben-Pruefung und Cap-Rearm;
  // ein Ueber-Zeit- oder Ueber-Guthaben-Leg wird terminalisiert statt reanimiert.
  // Vertraut NUR der DB, nie dem Request-Body (die ccid ist bereits durch E1 gefiltert).
  // Nebeneffekt (Spiegel-Mutation, ggf. Terminalisierung + Cap-Rearm) im Namen (N7).
  // JEDER Miss-Fall wird mit seinem eigenen Grund geloggt; null -> der Aufrufer legt
  // fail-closed mit 403 auf.
  async function resolveOrReattachActiveCall(ccid) {
    const mirrored = store.getCallByControlId(ccid);
    if (mirrored && mirrored.status === "active") return mirrored;
    const { call, logUnknown } = await reattachActiveCallByControlId(ccid);
    if (call) {
      logShimReattach({ callId: call.id });
      return call;
    }
    if (logUnknown)
      logShimGate({
        reason: "call_unresolved",
        found: Boolean(mirrored),
        status: mirrored ? mirrored.status : null,
      });
    // logUnknown:false = der Call WAR aktiv, aber eine Sicherung hat gegriffen (Max-Dauer
    // oder erschoepfte Decke) und ihn bereits terminalisiert + gebucht. "kein aktiver Call"
    // waere hier irrefuehrend (G2) - eigener Grund-Token.
    else logShimGate({ reason: "reattach_terminalized" });
    return null;
  }

  return async function handleChatCompletion(req, res) {
    // 1) Existenz-Gate (Invariante 1): Flag aus -> 404, VOR jeder Arbeit/Parsing.
    if (!config.telnyx.telnyxAssistant.enabled) return res.status(HTTP_NOT_FOUND).end();

    // 2) Statischer Bearer (Befund 2, E2): Telnyx sendet das Integration-Secret als
    // Authorization: Bearer <secret>, pro Turn identisch. Leerer config-Wert -> 403
    // (Empty-Secret-Trap, safeEqual("","")===true waere sonst die Falle, wie D3).
    const secret = config.telnyx.telnyxAssistant.shimSharedSecret;
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
    if (config.telnyx.telnyxAssistant.shimDebugShape) logShimShape(forwardMetadataShape(req.body));
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
    // KS-P1b: der Spiegel ist nicht mehr die einzige Quelle - ein Call, dessen Zeile erst
    // NACH hydrate() dieser Instanz entstand, wird ueber den geteilten Re-Attach-Seam
    // nachgeladen, statt das Live-Gespraech ohne Cap-Timer und ohne Watchdog weiterlaufen
    // zu lassen (KS-P1-Befund). Alle drei Miss-Faelle loggt die Aufloesung selbst.
    const call = await resolveOrReattachActiveCall(ccid);
    if (!call) return res.status(HTTP_FORBIDDEN).end();

    const locale = localeFor(call.language);
    const model =
      typeof req.body?.model === "string" && req.body.model ? req.body.model : config.llm.claudeModel;
    // OpenAI-spec-Modus: strikt stream===true -> SSE-Delta-Sequenz; sonst (false/
    // fehlend/nicht-boolean) -> plain chat.completion-JSON. Telnyx sendet live stream:true.
    const wantsStream = req.body?.stream === true;

    // AL-P7: der offene Strom dieses Requests - nur wenn der Request stream:true verlangt
    // UND das Flag an ist. null = Bestandspfad (writeCompletion), byte-identisch.
    const wire =
      wantsStream && config.telnyx.telnyxAssistant.shimTokenStreaming
        ? makeStreamingResponse(res, model)
        : null;

    // EINE Antwort-Schreibstelle dieses Requests (G5/G23). Ohne offenen Strom exakt der
    // Bestands-Dispatch; mit offenem Strom haengt der Satz als LETZTER Chunk an - eine
    // zweite Completion ist dort strukturell unmoeglich (der Client liest schon).
    function respond(content) {
      if (wire) return wire.finish(content);
      writeCompletion(res, { model, content, stream: wantsStream });
    }

    // 4.6) Loop-Guard + Dead-Air-Feed (Kosten-Notaus, ZUSAETZLICH zum Rate-Limiter):
    // Jeder aufgeloeste Turn fuettert den Dead-Air-Timer (Lebenszeichen) und fuehrt den
    // Leer-Turn-Streak fort. M konsekutive nicht-substanzielle Turns -> kontrollierte
    // Terminierung, VOR agentTurn (kein Token-Burn): Abschiedssatz ZUERST, dann realer
    // Hangup (Muster Budget-Gate, Schritt 6). Substanz = EINE geteilte Quelle.
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

    // GQ-S1 Sonde A (B-1): VOR jedem folgenden Gate (Loop-Guard/Rate/Budget), damit die
    // Zeile auch dann steht, wenn der Turn gleich terminiert wird - turn_ok feuert dort
    // nie. Liest nur; weder turnSeq noch emptyStreak noch das Rate-Fenster werden
    // beruehrt. gapMs+prevRelation trennen die Doppel-Zustellung (gleicher Hash, gleiche
    // Request-ID) vom fortgeschriebenen STT-Ergebnis (Vorgaenger ist Praefix).
    // GQ-P1: das Sonden-Ergebnis wird jetzt GEBUNDEN statt direkt gespreadet - prevRelation
    // ist ab hier die Entscheidungsgrundlage des Riegels (Schritt 7), nicht nur Logstoff.
    // GQ-P5: das Sonden-Ergebnis wird jetzt GEBUNDEN statt direkt gespreadet - lastRole ist
    // ab hier die Entscheidungsgrundlage des Anstoss-Riegels (Schritt 6.5), nicht nur
    // Logstoff. EINE Auswertung des Payloads, kein zweiter, driftender Leser (G5).
    const turnText = observeTurnText(call.id, callerText);
    const origin = requestOriginShape(req);
    logShimTurnProbe({
      callId: call.id,
      turnSeq,
      ...turnText,
      ...origin,
    });

    // EINE Stelle (G5) fuer den Budget-Notaus: Abschluss-Ansage ZUERST, dann realer Hangup
    // (Weg iii, telnyx-p6). Genutzt vom Gate VOR dem Turn (Schritt 6) UND vom Abbruch
    // WAEHREND des Turns (Schritt 7, AL-P6) - derselbe Grund-Token, derselbe Satz,
    // dieselbe Sofort-Terminierung. Kein Abschieds-Delay: hier gibt es keinen Abschied zu
    // schuetzen, nur Kosten zu stoppen (Regel 1).
    async function killCallForBudget(reason) {
      logShimGate({ reason, callId: call.id, tenantId: call.tenantId, turnSeq });
      respond(locale.budgetExhaustedHangup);
      await terminateCall(call.id);
    }

    if (loopExceeded) {
      logShimGate({ reason: "loop_guard", callId: call.id, turnSeq });
      respond(locale.llmDegradedSpeech);
      await terminateCall(call.id);
      return;
    }

    // 5) Rate-Gate (P5, Scope 4): N+1 Turns fuer denselben Call im Fenster -> definierte
    // Ablehnung OHNE agentTurn-Aufruf (kein Token-Burn). Gueltige Degradations-Completion
    // (Muster Budget-Gate unten), damit Telnyx den Turn nicht als abgebrochen/stumm liest.
    if (!shimRateHit(call.id).allowed) {
      logShimGate({ reason: "rate_limited", callId: call.id, turnSeq });
      return respond(locale.llmDegradedSpeech);
    }

    // 6) Budget-Gate (Invariante 3 / Regel 1, Token-Achse): kein agentTurn-Aufruf bei
    // Cap-Ueberschreitung (kein Token-Burn). P6 (Weg iii): Abschluss-Ansage ZUERST, DANN den
    // Call REAL auflegen - sonst deckt der Cap nur die Ansage, die Tokenkosten liefen weiter
    // (Regel 1 verlangt BEIDE Achsen). terminateCall ist fail-safe (kein callControlId ->
    // Skip + Log, eigener try/catch, secret-frei) - dasselbe GETEILTE Primitiv wie der
    // Loop-Guard (Schritt 4.6) und der end_call-Hangup (Schritt 8, G5). Settlement bleibt
    // P4.5 onHangup (EIN idempotenter Pfad ueber den ausgeloesten call.hangup-Event).
    const budgetAxis = blockingBudgetAxis({ store, billing: config.billing, tenantId: call.tenantId });
    if (budgetAxis) return await killCallForBudget(budgetAxis);

    // 6.5) GQ-P5: der Provider-Anstoss-Riegel. Telnyx stoesst nach
    // telephony_settings.user_idle_reply_secs Sekunden Stille von sich aus einen Turn an
    // ("the assistant will prompt the user to respond", Anbieter-Schema; Live-Wert 4).
    // Dieser POST traegt KEINE neue Aeusserung - seine letzte Nachricht ist eine
    // System-Nachricht. lastUserText liest aber nur die letzte user-Rolle und liefert
    // deshalb die ALTE Aeusserung: der Shim beantwortet sie ein zweites Mal, spricht die
    // Antwort aus, und die eigene Sprechzeit ist aus Anrufersicht wieder Stille -> der
    // naechste Anstoss. Am Beleg-Anruf call_msf0epenyv9g sechs Runden dieser Schleife
    // ("Gerne, ich warte." / "Ich warte still.", turnSeq 4/5/8/9/10/17), waehrend die
    // Gegenstelle woertlich sagte "Ich hab nix gesagt".
    //
    // Der Riegel antwortet mit einer LEEREN, gueltigen Completion - exakt die Form, die der
    // Bestand seit AL-P7/GQ-P1 fuer den bereits gestreamten und den verdraengten Turn
    // schickt und die Telnyx nicht als abgebrochenen Turn liest. Kein agentTurn-Aufruf:
    // kein Token-Burn, kein gesprochener Satz.
    //
    // REIHENFOLGE IST BINDEND: NACH observeTurn (Schritt 4.6). Der Anstoss IST ein
    // Lebenszeichen - die Leitung steht. Wuerde er den Dead-Air-Timer nicht mehr
    // zuruecksetzen, terminierte der Notaus genau waehrend einer laufenden Rueckfrage, in
    // der der Anrufer absichtlich schweigt und auf Auskunft wartet. Ein aufgelegtes
    // Gespraech waere schlimmer als der Satz zu viel, den dieser Riegel verhindert.
    // Die Kosten-Backstops fuer den WIRKLICH verlassenen Anruf liegen unberuehrt daneben:
    // die pro-Tenant-Kostendecke (Schritt 6, direkt darueber) und Telnyx'
    // telephony_settings.time_limit_secs.
    // GQ-P7: der Riegel darf NICHT absolut sein. Am Live-Anruf call_msfwfmf7thof gemessen:
    // die Rueckfrage-Antwort traf um 09:44:24 ein, danach kamen SIEBEN Anstoesse in Folge
    // (turnSeq 5..11) - alle blockiert, der Agent bekam bis zum Gespraechsende um 09:44:52
    // keinen einzigen Turn, in dem er die Antwort haette aussprechen koennen. Die Gegenstelle
    // schwieg ja, also gab es keinen user-Turn mehr. Ergebnis: objective_achieved=false,
    // obwohl die Auskunft seit 28 Sekunden im Prompt stand.
    //
    // Genau EIN Anstoss darf deshalb durch, wenn eine eingetroffene Antwort noch keinen Turn
    // gesehen hat. Einmalig, nicht dauerhaft: der ausgefuehrte Turn setzt unten deliveredAt,
    // ab dann greift der Riegel wieder. Die Schleife bleibt tot (hoechstens ein zusaetzlicher
    // Turn je Rueckfrage-Antwort), der Zustell-Moment lebt.
    const providerNudge = origin.lastRole === MESSAGE_ROLE_SYSTEM;
    const consultDeliveryDue = consultAnswerAwaitingDelivery(call);
    if (config.telnyx.telnyxAssistant.shimIgnoreProviderNudge && providerNudge && !consultDeliveryDue) {
      logShimGate({ reason: "provider_nudge", callId: call.id, turnSeq });
      return respond("");
    }

    // 7) Kern: agentTurn (in-house Tool-Loop) gegen die per Call-Control-ID gebundene,
    // frische call-Referenz.
    // GQ-P1 (Befund B-1), der Riegel. REIHENFOLGE IST BINDEND: hier, NACH Loop-Guard,
    // Rate-Gate und Budget-Gate. Erst jetzt steht fest, dass DIESER Request wirklich einen
    // Agenten-Turn faehrt; ein frueher verdraengter Vorgaenger haette seine echte Antwort
    // fuer eine blosse Degradations-/Abschiedsansage geopfert. Der Riegel liest nur -
    // turnSeq, emptyStreak, Rate-Fenster und Budget-Buchung bleiben unberuehrt.
    // NUR "extends": "same" ist der Consult-Nachfass (wer ihn mitbehandelt, unterdrueckt
    // Consult-Antworten), "other" sind zwei echte Aeusserungen.
    if (
      config.telnyx.telnyxAssistant.shimSupersedeExtendedTurn &&
      turnText.prevRelation === TURN_TEXT_RELATION.EXTENDS
    )
      logShimSupersede({ callId: call.id, turnSeq, ...inFlightTurns.supersedeTurn(call.id) });

    // GQ-P1: ab hier ist DIESER Turn der laufende Turn des Calls. hasSpokenText ist die
    // eine Bedingung, die einen Abbruch verbietet: was auf der Leitung war, holt kein
    // Retract-Event zurueck (Fail-safe-Richtung - lieber zwei Antworten als Stille).
    const inFlight = inFlightTurns.beginTurn(call.id, {
      hasSpokenText: () => Boolean(wire) && wire.chunkCount() > 0,
    });

    // GQ-P1: der Sprech-Draht dieses Turns wird im Moment der Verdraengung stumm. Ohne
    // diesen Waechter schriebe eine bereits laufende Modellrunde ihre restlichen Saetze
    // weiter auf die Leitung - der Anrufer hoerte genau die Antwort, die verworfen wird.
    // Ohne offenen Strom (wire === null) bleibt es null: streamSinkFor (claude.js) steigt
    // an genau dieser Bedingung aus, das ist byte-identisch zum Bestand.
    const speakChunk = wire
      ? (text) => {
          if (!inFlight.signal.aborted) wire.writeChunk(text);
        }
      : null;

    let endCall = false;
    let farewellChars = 0; // Basis der Sprechdauer-Schaetzung (Schritt 8)
    // GQ-P4/A2: hat agentTurn SELBST geliefert? Der Catch unten faengt AUCH Fehler des
    // Antwort-Schreibwegs NACH einem erfolgreichen Turn (das dokumentierte T1-Szenario).
    // Die duerfen den Fehlschlag-Zaehler nicht fuettern - ein faelschlich beendetes
    // Gespraech ist schlimmer als ein Turn zu viel (harte Randbedingung dieser Phase).
    let modelAnswered = false;
    try {
      // AL-D1: Momentaufnahme VOR dem Turn - genau der Zeitpunkt, zu dem agentTools()
      // ueber get_consult entscheidet. Nach dem Turn gemessen waere es eine andere Zahl.
      // GQ-P2/B-2: EINE Uhrzeit fuer beide Felder, sonst koennten sie sich widersprechen.
      const pollMeasuredAtMs = Date.now();
      const consultPollFresh = consultClientIsPolling(call, pollMeasuredAtMs);
      const consultPollAge = consultPollAgeMs(call, pollMeasuredAtMs);
      const startedAt = Date.now();
      const turn = await agentTurn(call, callerText, {
        onSpeechChunk: speakChunk,
        abortSignal: inFlight.signal,
      });
      const latencyMs = Date.now() - startedAt;
      // GQ-P4/A2: ein erfolgreicher Turn loescht die Fehlschlag-Staffel - gezaehlt werden
      // NUR echte Fehlschlaege IN FOLGE.
      modelAnswered = true;
      clearFailedTurns(call.id);
      // GQ-P7: dieser Turn HAT die wartende Rueckfrage-Antwort im Prompt gesehen - damit ist
      // ihr Zustellfenster verbraucht. Bewusst NACH dem await: wirft agentTurn, bleibt die
      // Antwort unausgeliefert und oeffnet beim naechsten Anstoss erneut (fail-safe-Richtung,
      // lieber ein Turn zu viel als eine verlorene Auskunft). Gilt fuer JEDEN ausgefuehrten
      // Turn, nicht nur den Anstoss: spricht die Gegenstelle von selbst weiter, traegt ihr
      // Turn die Antwort genauso - ein spaeteres Zustellfenster waere dann sinnlos.
      if (consultDeliveryDue) store.markConsultAnswerDelivered(call.id);
      // EIN latencyMs-Wert, zwei Senken: der opt-in metrics-Seam (P10, hinter metricsEnabled,
      // NICHT TTFT sondern Gesamt-Turn) UND das UNCONDITIONAL OBS-1-Betriebssignal (im Vorfall
      // war metricsEnabled AUS = kein Lebenszeichen). Bewusst getrennte Kanaele/Prefixe.
      metrics.logShimTurn({ callId: call.id, latencyMs });
      logShimTurnOk({
        callId: call.id,
        latencyMs,
        turnSeq,
        // AL-D2: hatte dieser Turn ueberhaupt einen offenen Sprechkanal? An genau diesem
        // Kanal haengen BEIDE Streaming-Faehigkeiten: ohne ihn bekommt agentTurn keinen
        // onSpeechChunk, und dann steigen streamSinkFor (AL-P7) UND speakBridge (AL-P7b)
        // an derselben Bedingung aus. streamChunks:0 allein kann "kein Kanal" nicht von
        // "Kanal offen, aber nichts gesendet" trennen - genau diese Mehrdeutigkeit blieb
        // nach den Live-Anrufen vom 2026-08-01 stehen. Ein Boolean, kein Text.
        speechWireOpen: wire !== null,
        // AL-P7: die Live-Sonde, an der der Owner sieht, DASS gestreamt wurde. Eine Zahl,
        // kein Text - die PII-Freiheit der Zeile bleibt unberuehrt.
        streamChunks: wire ? wire.chunkCount() : 0,
        // AL-D1: wartete zu Turn-Beginn ueberhaupt ein MCP-Client? Ein Boolean, kein Text.
        consultPollFresh,
        // GQ-P2/B-2: WIE alt der Poll war. Der Boolean allein kann "nie gepollt" (-1) nicht
        // von "um Millisekunden zu alt" trennen - genau daran scheiterte die B-2-Diagnose.
        consultPollAgeMs: consultPollAge,
        ...turnDiagnostics(turn, callerText),
      });
      // P5 (OBS/R6): unter demselben default-off TELNYX_SHIM_DEBUG_SHAPE-Flag und demselben
      // shape-Kanal (logShimShape) eine PII-freie Zeile, die den eingehenden messages-Payload
      // mit speechEmpty verknuepft - trennt "Brain lieferte leeren Text" von "Vendor sprach
      // nicht" (§2.2). Nur auf dem Erfolgspfad (es gibt ein Turn-Ergebnis); reine Diagnose,
      // messagesTurnShape ist wurf-frei und darf die bereits erfolgreiche Turn-Response nicht
      // in den Catch reissen.
      if (config.telnyx.telnyxAssistant.shimDebugShape) logShimShape(messagesTurnShape(req.body, turn));
      // AL-P6: agentTurn hat den Loop wegen einer erschoepften Budget-Achse abgebrochen.
      // Derselbe Notaus wie das Gate VOR dem Turn - sonst liefe der Call auf Carrier-
      // Minuten weiter, bis der naechste Turn Schritt 6 trifft (Regel 1, beide Achsen).
      // Der Zeit-Abbruch (deadline) fuehrt bewusst NICHT hierher: der Turn hat eine
      // gueltige Antwort, das Gespraech laeuft normal weiter.
      if (isBudgetAxis(turn.stopReason)) return await killCallForBudget(turn.stopReason);
      endCall = turn.endCall === true;
      farewellChars = speechTextOf(turn).length;
      // AL-P7: hat der Turn seinen Text bereits satzweise gesprochen, fehlt nur noch der
      // Abschluss - ihn ein zweites Mal zu senden waere Doppelrede. Der Abschiedssatz geht
      // weiterhin ZUERST raus, nur frueher.
      // AL-P7b: die Auskunft kommt jetzt vom TURN, nicht mehr aus der Chunk-ZAHL. Seit dem
      // Denk-Signal sind das zwei verschiedene Aussagen: der Ueberbrueckungssatz IST ein
      // Chunk, die Antwort steht aber noch aus - die Chunk-Zahl haette sie verschluckt und
      // der Anrufer haette nach "einen Moment" nur Stille gehoert.
      // Fail-safe-Richtung (=== true): fehlt das Feld, wird der Text GESPROCHEN. Der
      // schlimmste Fall ist eine Wiederholung, nicht eine verschwundene Antwort.
      // GQ-P1: ein verdraengter Turn SPRICHT nicht - aber er ANTWORTET. Eine leere,
      // gueltige Completion ist die einzige Form, die Telnyx nicht als abgebrochenen Turn
      // liest (Stille waere schlimmer als der Doppel-Turn); es ist exakt dieselbe Form,
      // die der Bestand seit AL-P7 schickt, wenn der Text bereits gestreamt wurde.
      // Ein benannter Ausdruck statt eines verschachtelten Ternary (G28).
      const speechAlreadyHandled = turn.superseded === true || turn.speechStreamed === true;
      respond(speechAlreadyHandled ? "" : turn.speech);
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
      // GQ-P4/A1: der Bezahl-/Guthaben-Fall ist ein EIGENER Zustand - unabhaengig davon,
      // ob der Anbieter ihn als 402 oder (Anthropic) als 400 verpackt. Klassifikation in
      // llm.js (EINE Quelle, G5); hier nur der Alarm (A4).
      const billingBlocked = isProviderBillingError(err);
      if (billingBlocked) logShimBillingAlarm({ callId: call.id, turnSeq });
      // GQ-P4/A2: N Fehlschlaege IN FOLGE -> wuerdevoll beenden statt stumm weiterlaufen.
      const failedTurns = modelAnswered ? 0 : countFailedTurn(call.id);
      const giveUp = failedTurns >= config.telnyx.telnyxAssistant.maxConsecutiveFailedTurns;
      const content = giveUp ? farewellSpeechFor(locale) : degradedSpeechFor(err, locale);
      // Dieser Catch faengt AUCH Fehler aus writeCompletion selbst (kein eigener
      // try/catch dort): wirft der Happy-Path-writeCompletion NACH einem Teil-Write
      // (z.B. Socket bricht zwischen den SSE-res.write-Aufrufen weg), ist
      // headersSent bereits true - ein zweiter writeCompletion-Versuch wuerde erneut
      // in denselben kaputten Stream schreiben. Stattdessen nur end() (bestmoegliches
      // Aufraeumen); der Client sieht einen abgebrochenen Stream statt einer zweiten,
      // ueberlappenden Antwort. Regressionstest: T1 in telnyx-llm-shim.test.js.
      // AL-P7: die Degradation hat jetzt ZWEI Faelle statt einem.
      //  - Strom noch offen (auch: noch gar nichts geschrieben) -> der Abbruchsatz geht als
      //    LETZTER Chunk raus. Nach dem ersten gestreamten Byte ist eine frische Completion
      //    strukturell unerreichbar; ein LLM-freier Satz ist es nicht.
      //  - Strom bereits abgeschlossen ODER mitten im Schreiben gerissen (headersSent, T1)
      //    -> nur end(). Ein zweiter Schreibversuch ginge in denselben kaputten Strom.
      // GQ-P4/A3: welcher Zweig lief, wird MITGESCHRIEBEN - der Sendepfad selbst bleibt
      // unveraendert (die Spec verbietet ausdruecklich, ihn auf Verdacht zu aendern).
      let degradedPath = DEGRADED_PATH.WIRE_LOST;
      if (wire && !wire.isFinished()) {
        wire.finish(content);
        degradedPath = DEGRADED_PATH.STREAM_TAIL;
      } else if (!res.headersSent) {
        writeCompletion(res, { model, content, stream: wantsStream });
        degradedPath = DEGRADED_PATH.FRESH_COMPLETION;
      } else res.end();
      logShimDegraded({
        callId: call.id,
        turnSeq,
        path: degradedPath,
        // Zeichen, die den Shim WIRKLICH verlassen haben: auf dem wire_lost-Weg sind es null.
        chars: degradedPath === DEGRADED_PATH.WIRE_LOST ? 0 : content.length,
        // War vor der Degradation schon Text auf der Leitung? Trennt "der Anrufer hoerte
        // gar nichts" von "er hoerte den Anfang und dann den Abbruchsatz".
        streamChunks: wire ? wire.chunkCount() : 0,
        billingBlocked,
        failedTurns,
        giveUp,
      });
      // GQ-P4/A2: der Abschied laeuft ueber GENAU DENSELBEN Weg wie ein end_call des
      // Modells (Schritt 8): Satz zuerst, Hangup verzoegert um die geschaetzte Sprechdauer,
      // abblasbar durch einen neuen Turn oder einen externen call.hangup. Kein zweiter
      // Terminierungspfad (G5). ZUSAETZLICHES Ende - die Max-Dauer-Notbremse, der
      // Dead-Air-Watchdog und der Budget-Kill bleiben unberuehrt.
      // Der Zaehler wird hier BEWUSST NICHT geloescht: blaest ein neuer Turn den Abschied
      // ab und scheitert erneut, soll sofort wieder beendet werden - nicht erst nach
      // weiteren N Fehlschlaegen.
      if (giveUp) {
        endCall = true;
        farewellChars = content.length;
      }
      // KEIN return hier (G3/T5): agentTurn kann VOR diesem Fehler bereits erfolgreich
      // endCall=true geliefert haben - der Fehler stammt dann aus writeCompletion selbst
      // (Zeile oben, exakt das T1-Szenario), NICHT aus agentTurn. Schritt 8 unten muss den
      // Hangup trotzdem versuchen, sonst laeuft der Call trotz bereits gegebenem
      // Abschiedssignal auf Tokenkosten weiter (Regel 1). Wirft dagegen agentTurn selbst,
      // bleibt endCall auf dem Default false - AUSSER die Fehlschlag-Staffel ist voll
      // (GQ-P4/A2), dann setzt der Zweig oben endCall/farewellChars und Schritt 8 spricht
      // den Abschied und legt verzoegert auf.
    } finally {
      // GQ-P1: dieser Turn laeuft nicht mehr - ein spaeterer "extends"-Request darf ihn
      // nicht mehr verdraengen. Im finally, damit auch der Fehlerpfad abmeldet.
      inFlight.endTurn();
    }

    // 8) end_call (Wurzel R4): der Abschiedssatz ist als Completion raus - die TTS-
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

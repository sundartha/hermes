// Brain-Shim (PLAN-TELNYX-AI-ASSISTANT.md, Phase P1): in-house /v1/chat/completions-
// kompatibler Endpunkt. Kapselt agentTurn (claude.js) und framt die Antwort als
// Fake-Stream (1 SSE-Chunk + data: [DONE]). Bei C-Telnyx UND C-ElevenLabs identisch.
// Existenz + Auth fail-closed hinter TELNYX_AI_ASSISTANT_ENABLED (404 bis Cutover).
// KEINE Safety-Gate-Umgehung, KEINE llm.js-Aenderung, KEIN Direktimport von execTool/
// toolDefs (agentTurn ruft sie in-house auf -> S2-Anti-Duplizierung).
import { randomUUID } from "node:crypto";
import { safeEqual } from "./util.js";
import { degradedSpeechFor } from "./llm.js";

// OpenAI-SSE-Konstanten (G25, keine Magic-Strings gestreut):
const OPENAI_CHUNK_OBJECT = "chat.completion.chunk";
const CHAT_COMPLETION_ID_PREFIX = "chatcmpl-";
const FINISH_STOP = "stop";
const SSE_DONE = "data: [DONE]\n\n";
const BEARER_PREFIX = "Bearer ";
const TOKEN_SEP = ":";
const MS_PER_SECOND = 1000;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

// Letzte User-Aeusserung aus dem OpenAI-messages-Array (nur STRING-Content, sonst "").
// Der Shim nutzt NUR die neueste Aeusserung als callerText; die Gespraechs-Historie
// lebt im Store (call.transcript, agentTurn baut sie frisch) - kein Vertrauen in die
// vom Provider gespiegelte messages-Kette (Spoofing-/Drift-Schutz, Invariante 5).
function lastUserText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

// Zerlegt "Bearer <callId>:<secret>" -> { callId, secret } | null (fail-closed).
// Split am ERSTEN ":" (callId enthaelt nie ":", state-ops.js:newId); secret ist der
// gesamte Rest (kann selbst ":" enthalten, wird nicht weiter zerlegt).
function parseCallToken(authHeader) {
  if (typeof authHeader !== "string" || !authHeader.startsWith(BEARER_PREFIX)) return null;
  const token = authHeader.slice(BEARER_PREFIX.length);
  const sepIdx = token.indexOf(TOKEN_SEP);
  if (sepIdx < 0) return null;
  const callId = token.slice(0, sepIdx);
  if (!callId) return null;
  return { callId, secret: token.slice(sepIdx + 1) };
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

export function makeTelnyxLlmShim({ store, config, agentTurn, localeFor, voiceControl }) {
  // P3a (Regel 1 / Befund 6): end_call MUSS den Call REAL beenden. Anders als in der
  // Budget-Engine (dort rendert der Server hangupD aus {speech,endCall}) gibt es bei
  // C-Telnyx keinen Text-Rueckkanal "leg auf" - ohne echten Hangup laeuft der Call plus
  // Tokenkosten weiter. Terminierung out-of-band ueber Call-Control; KEIN zweiter Store-
  // Write (Settlement kommt ueber den call.hangup-Event -> P4.5 onHangup, EIN idempotenter
  // Pfad ueber billedAt/reserveReleased).
  async function terminateViaCallControl(call) {
    // Frischer Store-Stand (Pre-Mortem): callControlId kann waehrend des Turns gesetzt
    // worden sein - nicht auf den Turn-Anfang-Stand vertrauen (Muster P4.5 onHangup).
    const fresh = store.getCall(call.id);
    const callControlId = fresh && fresh.callControlId;
    if (!callControlId) {
      // fail-safe: callControlId persistiert erst P5 (Origination). Fehlt sie -> Skip + Log,
      // KEIN Crash/Orphan (die Response ist bereits raus), Muster P4.5 assistantId-Handling.
      console.warn(`[telnyx-shim] end_call ohne callControlId (call=${call.id}) -> kein Hangup`);
      return;
    }
    try {
      // Eigener try/catch: ein Hangup-Fehler darf die BEREITS gesendete Response nicht
      // nachtraeglich zerstoeren; nur secret-frei loggen (err.name, Muster P4.5 onHangup).
      await voiceControl(call.provider).endCallViaCallControl(callControlId);
    } catch (err) {
      console.error("[telnyx-shim] Call-Control-Hangup fehlgeschlagen:", err && err.name);
    }
  }

  return async function handleChatCompletion(req, res) {
    // 1) Existenz-Gate (Invariante 1): Flag aus -> 404, VOR jeder Arbeit/Parsing.
    if (!config.telnyxAiAssistantEnabled) return res.status(HTTP_NOT_FOUND).end();

    // 2) Per-Call-Token (Invariante 2 + D3): callId NUR aus dem Token, nie aus dem
    // spoofbaren OpenAI-Body (Invariante 5/Anti-Spoofing).
    const parsed = parseCallToken(req.headers.authorization || "");
    if (!parsed || !parsed.secret) return res.status(HTTP_FORBIDDEN).end();
    const call = store.getCall(parsed.callId); // lebende Store-Referenz, kein DTO
    const stored = call && call.aiAssistantToken;
    // D3: leeres/fehlendes Token-Feld darf NIE autorisieren (safeEqual("","")===true).
    if (!stored || !safeEqual(parsed.secret, stored)) return res.status(HTTP_FORBIDDEN).end();

    const locale = localeFor(call.language);
    const model =
      typeof req.body?.model === "string" && req.body.model ? req.body.model : config.claudeModel;

    // 3) Budget-Gate (Invariante 3 / Regel 1): kein agentTurn-Aufruf bei Cap-Ueberschreitung
    // (kein Token-Burn). Hangup-Aktion (Call-Control) erst P6.
    if (store.budgetExceeded(call.tenantId, config) || store.globalBudgetExceeded(config))
      return writeFakeStream(res, { model, content: locale.budgetExhaustedHangup });

    // 4) Kern: agentTurn (in-house Tool-Loop) gegen die TOKEN-gebundene, frische call-Referenz.
    let endCall = false;
    try {
      const turn = await agentTurn(call, lastUserText(req.body));
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
      console.error("[telnyx-shim] agentTurn fehlgeschlagen:", err && err.name); // secret-frei
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
      // (Zeile oben, exakt das T1-Szenario), NICHT aus agentTurn. Schritt 5 unten muss den
      // Hangup trotzdem versuchen, sonst laeuft der Call trotz bereits gegebenem
      // Abschiedssignal auf Tokenkosten weiter (Regel 1). Wirft dagegen agentTurn selbst,
      // bleibt endCall auf dem Default false - Schritt 5 ist dann ein No-op.
    }

    // 5) end_call (P3a, Regel 1): der Abschiedssatz ist raus (oder bestmoeglich degradiert);
    // jetzt den Call out-of-band REAL beenden, falls agentTurn end_call lieferte - unabhaengig
    // davon, ob der nachfolgende Response-Write selbst noch erfolgreich war (siehe Kommentar
    // oben). Reihenfolge ist Absicht - speech ZUERST, Hangup danach (P11-Live-Kriterium: ob
    // der Call-Control-Hangup gepuffertes TTS abschneidet, ist live UNBESTAETIGT, wie P4/P4.5).
    if (endCall) await terminateViaCallControl(call);
  };
}

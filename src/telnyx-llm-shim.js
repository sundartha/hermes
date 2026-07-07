// Brain-Shim (PLAN-TELNYX-AI-ASSISTANT.md, Phase P1): in-house /v1/chat/completions-
// kompatibler Endpunkt. Kapselt agentTurn (claude.js) und framt die Antwort als
// Fake-Stream (1 SSE-Chunk + data: [DONE]). Bei C-Telnyx UND C-ElevenLabs identisch.
// Existenz + Auth fail-closed hinter TELNYX_AI_ASSISTANT_ENABLED (404 bis Cutover).
// KEINE Safety-Gate-Umgehung, KEINE llm.js-Aenderung, KEIN Direktimport von execTool/
// toolDefs (agentTurn ruft sie in-house auf -> S2-Anti-Duplizierung).
import { randomUUID } from "node:crypto";
import { safeEqual } from "./util.js";
import { LlmUnavailableError } from "./llm.js";

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

export function makeTelnyxLlmShim({ store, config, agentTurn, localeFor }) {
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
    try {
      const { speech } = await agentTurn(call, lastUserText(req.body));
      return writeFakeStream(res, { model, content: speech });
    } catch (err) {
      // P2 (Resilienz-Bruecke): NIE roher 5xx/leerer Hang - Telnyx liest den als
      // abgebrochenen/stummen Turn. Stattdessen dieselbe Zwei-Klassen-Degradation wie
      // der /voice/turn-Catch (server.js): transient-erschoepft (LlmUnavailableError -
      // Breaker offen ODER Retries erschoepft) -> llmDegradedSpeech; jeder ANDERE Fehler
      // (nicht-transient, z.B. 4xx/Auth) -> turnErrorSpeech. Der Fehler wird weiter
      // geloggt (nur err.name, secret-frei), nur die Antwort ist eine gueltige Completion.
      // KEIN Retry hier (der llm.js-Seam hat bereits begrenzt+selektiv retried).
      console.error("[telnyx-shim] agentTurn fehlgeschlagen:", err && err.name); // secret-frei
      const content =
        err instanceof LlmUnavailableError ? locale.llmDegradedSpeech : locale.turnErrorSpeech;
      if (!res.headersSent) writeFakeStream(res, { model, content });
      else res.end();
    }
  };
}

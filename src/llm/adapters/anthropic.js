// Anthropic-Adapter (llm/ports.js LlmProvider). Das ist die EINE Uebersetzungsstelle
// zwischen unserer neutralen Form und Anthropics Vokabular - eine zweite waere per
// Definition Duplizierung (G5/S2). Wer hier etwas sucht, sucht Anbieter-Wissen; wer
// Resilienz sucht (Breaker, Retry, Backoff, Wanduhr, Metrik), sucht im Seam src/llm.js.
//
// B3a neutralisiert die ANTWORTSEITE. Die Anfrage (system/tools/max_tokens/tool_choice/
// cache_control) reicht der Adapter in B3a noch unveraendert durch, bis auf die
// Nachrichten-Kette: dort uebersetzt er die zwei neutralen Formen aus llm/messages.js.
//
// providerTurn traegt die GANZE Anbieter-Antwort, nicht nur ihre content-Liste:
// src/research/adapters/anthropic-web-search.js liest daraus usage.server_tool_use, um
// die tatsaechlich ausgefuehrten Suchen zu buchen. Ein Feld, das nur content traegt,
// erzwaenge einen zweiten Rohform-Kanal. Vertragskonform, weil llm/ports.js nur dem
// AUFRUFER das Lesen verbietet - gelesen wird providerTurn ausschliesslich von
// anbieter-spezifischen Adaptern.
//
// Connection-Hygiene: Das SDK 0.105 nutzt native fetch (undici unter Node) statt
// node-fetch/agentkeepalive. Ein expliziter undici-Dispatcher mit kurzem
// keepAliveTimeout (Umbrella 3.3) bleibt VORERST aussen vor: undici ist in Node 22
// NICHT als importierbares Modul freigegeben (nur intern fuer global fetch; empirisch
// belegt: import "undici"/"node:undici" werfen ERR_MODULE_NOT_FOUND/ERR_UNKNOWN_BUILTIN_MODULE,
// kein globalThis.getGlobalDispatcher). Ein eigener Dispatcher braeuchte daher undici
// als neue Dependency - ausserhalb des aktuellen Scopes (Owner-Freigabe noetig). Die Hygiene
// wirkt weiter ueber das Retry selbst: maxRetries:0 am SDK + manueller Retry holt beim
// Re-Request eine frische fetch-Connection (vergifteter Socket wird nicht im selben
// fetch wiederverwendet). Zusaetzlich faengt isTransient den neuen undici-Premature-
// close (UND_ERR_SOCKET) sowohl ueber APIConnectionError als auch als Defense-in-Depth.
import Anthropic from "@anthropic-ai/sdk";
import { TOOL_RESULTS_ROLE } from "../messages.js";

// Transiente HTTP-Status: Verbindungs-/Lastklasse, vom Server gefahrlos wiederholbar.
// 408 Timeout, 409 Conflict, 429 RateLimit, >=500 Server. NICHT 400/401/403/404/422.
const RETRYABLE_STATUS = new Set([408, 409, 429]);
const SERVER_ERROR_MIN = 500;
// Rohe Transport-Fehlercodes (Verbindungsklasse, gefahrlos wiederholbar).
// UND_ERR_SOCKET = undici "other side closed": Unter dem SDK 0.105 (native fetch)
// erscheint der Premature close als APIConnectionError (von isTransient ueber branch 1
// gefangen); dessen verschachtelte cause traegt diesen undici-Code. Hier defensiv im
// Set, falls der instanceof-Pfad je ausfaellt (Defense-in-Depth, empirisch belegt).
// ERR_STREAM_PREMATURE_CLOSE bleibt als node-fetch-Erbe (Bedrock/aeltere Pfade).
const TRANSIENT_CODES = new Set([
  "ERR_STREAM_PREMATURE_CLOSE",
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
]);
const PREMATURE_CLOSE_MESSAGE = "Premature close";
// Anthropic-Fehlertyp fuer Abrechnungsprobleme. Er existiert (403-Klasse), deckt den
// beobachteten Guthaben-400 aber NICHT ab - er steht NEBEN, nicht STATT der Textpruefung.
const BILLING_ERROR_TYPE = "billing_error";
// FRAGIL, bewusst und eng gefasst: fuer den 400-Fall gibt es kein strukturiertes
// Unterscheidungsmerkmal, nur den Meldungstext ("Your credit balance is too low to access
// the Anthropic API ..."). Geprueft wird deshalb genau diese eine Wendung, klein
// geschrieben. Aendert der Anbieter den Wortlaut, faellt der Fall in den generischen
// Fehlerpfad zurueck - er wird nie falsch POSITIV, und es haengt KEIN Gate daran
// (nur eine Logzeile). Kein Praefix-/Fuzzy-Match.
const CREDIT_EXHAUSTED_MARKER = "credit balance is too low";

// Fugenzeichen zwischen zwei Textbloecken: EINE Quelle (G5) fuer den zusammengesetzten
// Text UND fuer das, was der Stream zwischen zwei Bloecken in den Sink schiebt. Genau
// darauf beruht die LlmTurn.text-Zusicherung "gestreamte Fragmente ergeben exakt diesen
// Text" (llm/ports.js).
const TEXT_BLOCK_JOINER = " ";
const TEXT_BLOCK = "text";
const TOOL_USE_BLOCK = "tool_use";
const TOOL_RESULT_BLOCK = "tool_result";

// --- Fehlerklassifikation (LlmErrorClassification): pur, ohne Client ---------------

// Transient = retrybar. Transient: Premature-close-FetchError, APIConnectionError,
// ECONNRESET & Co., HTTP 408/409/429/>=500. NICHT transient: 4xx (ausser 408/409/429),
// invalid_request, Auth -> sofort werfen (kein Over-Retry maskiert einen Config-Fehler).
function isTransient(err) {
  if (!err) return false;
  // 1) APIConnectionError/-Timeout (status undefined) -> transient.
  if (err instanceof Anthropic.APIConnectionError) return true;
  // 2) APIError mit status -> nur die retrybare Klasse.
  if (typeof err.status === "number")
    return RETRYABLE_STATUS.has(err.status) || err.status >= SERVER_ERROR_MIN;
  // 3) Rohe Transportfehler (Premature close & Co.) ueber code/message.
  if (err.code && TRANSIENT_CODES.has(err.code)) return true;
  if (err.message === PREMATURE_CLOSE_MESSAGE) return true;
  // 4) Verschachtelter Transportfehler (z.B. APIConnectionError.cause = ECONNRESET).
  if (err.cause && err.cause !== err) return isTransient(err.cause);
  return false; // 4xx/invalid_request/Auth/unbekannt -> sofort werfen
}

// "Uns ist bei ANTHROPIC das Geld ausgegangen" - nur die anbieter-eigenen Marken. Den
// anbieter-unabhaengigen Bezahl-Status (HTTP 402) beurteilt der Seam, nicht dieser
// Adapter: Anthropic meldet ihn nie, andere Anbieter schon.
function isBillingError(err) {
  if (err?.type === BILLING_ERROR_TYPE) return true;
  const message = typeof err?.message === "string" ? err.message : "";
  return message.toLowerCase().includes(CREDIT_EXHAUSTED_MARKER);
}

/** @type {import("../ports.js").LlmErrorClassification} */
export const anthropicErrors = { isTransient, isBillingError };

// --- Antwort -> LlmTurn -----------------------------------------------------------

const blocksOf = (resp) => (Array.isArray(resp?.content) ? resp.content : []);

function textOf(blocks) {
  return blocks
    .filter((b) => b.type === TEXT_BLOCK)
    .map((b) => b.text)
    .join(TEXT_BLOCK_JOINER)
    .trim();
}

// input ist bei Anthropic bereits ein Objekt; fehlt es, ist die leere Menge die richtige
// Angabe (llm/ports.js LlmToolCall verlangt ein Objekt, kein undefined).
function toolCallsOf(blocks) {
  return blocks
    .filter((b) => b.type === TOOL_USE_BLOCK)
    .map((b) => ({ id: b.id, name: b.name, input: b.input || {} }));
}

// Notfall-Regel des Vertrags (llm/ports.js LlmTokenUsage.estimated): fehlt eine Zahl,
// ist der Verbrauch NICHT gemeldet und wird als Schaetzung kenntlich gemacht.
function unreportedUsage(billingModelId) {
  return {
    inputUncachedTokens: 0,
    inputCacheWriteTokens: 0,
    inputCacheReadTokens: 0,
    outputTokens: 0,
    estimated: true,
    billingModelId,
  };
}

// Anthropic meldet drei Eingabe-Sorten getrennt. Fehlen die Cache-Zahlen, hat dieser
// Aufruf keine - 0 ist dann die richtige Angabe, NICHT "unbekannt" (llm/ports.js).
function toTokenUsage(usage, billingModelId) {
  const reported =
    typeof usage?.input_tokens === "number" && typeof usage?.output_tokens === "number";
  if (!reported) return unreportedUsage(billingModelId);
  return {
    inputUncachedTokens: usage.input_tokens,
    inputCacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    inputCacheReadTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens,
    estimated: false,
    // ANGEFORDERTE ID, nicht resp.model: Anthropic antwortet mit der aufgeloesten,
    // DATIERTEN Snapshot-ID, die in keiner Preistabelle steht - jeder Turn liefe damit
    // in den Fail-closed-Zweig (teuerste Rate) und das Budget waere systematisch zu
    // frueh erschoepft. Belegt: B1, 0/88 Abweichungen.
    billingModelId,
  };
}

/** @returns {import("../ports.js").LlmTurn} */
function toLlmTurn(resp, billingModelId) {
  const blocks = blocksOf(resp);
  return {
    text: textOf(blocks),
    toolCalls: toolCallsOf(blocks),
    usage: toTokenUsage(resp?.usage, billingModelId),
    providerTurn: resp,
    stopReason: resp?.stop_reason ?? null,
  };
}

// --- Neutrale Nachrichten -> Anthropic-Form ---------------------------------------

const toolResultBlock = (result) => ({
  type: TOOL_RESULT_BLOCK,
  tool_use_id: result.toolCallId,
  content: result.text,
});

// Die neutralen Eintraege in Anthropic-Form bringen; jeder andere Eintrag geht
// unveraendert durch (Bestandsform der Kette, bis B3b sie neutralisiert). Anthropic
// nimmt ALLE Werkzeug-Ergebnisse einer Runde in EINER user-Nachricht entgegen - die
// 1-zu-N-Abbildung anderer Anbieter ist Sache ihres Adapters.
function anthropicMessage(message) {
  if (message.providerTurn) return { role: "assistant", content: blocksOf(message.providerTurn) };
  if (message.role === TOOL_RESULTS_ROLE)
    return { role: "user", content: message.results.map(toolResultBlock) };
  return message;
}

// Ersetzt NUR das messages-Feld und laesst die Schluessel-REIHENFOLGE unangetastet:
// JSON.stringify serialisiert in Einfuegereihenfolge, und der ausgehende Body muss
// byte-identisch zum Bestand bleiben (Abnahme A3). Ein {...request, messages} wuerde
// messages ans Ende ziehen und damit den Draht veraendern.
function withAnthropicMessages(request) {
  const out = {};
  for (const [key, value] of Object.entries(request))
    out[key] = key === "messages" ? value.map(anthropicMessage) : value;
  return out;
}

// --- Factory ----------------------------------------------------------------------

// Ein Text-Delta des Anthropic-Streams (G28: die zusammengesetzte Bedingung bekommt
// einen Namen statt im if zu stehen). Rein (N7).
function isTextDelta(event) {
  return event.type === "content_block_delta" && event.delta.type === "text_delta";
}

// P15: Konstruktion/Verdrahtung getrennt vom Fachcode. messagesCreate/messagesStream
// sind optionale Test-Seams (DIP): gesetzt -> ersetzen sdk.messages.create bzw.
// sdk.messages.stream; sonst = der echte Prod-Pfad (kein toter Code).
export function createAnthropicProvider({
  apiKey,
  requestTimeoutMs,
  messagesCreate,
  messagesStream,
} = {}) {
  const sdk = new Anthropic({
    apiKey,
    timeout: requestTimeoutMs, // expliziter Per-Request-Timeout (Pflicht; SDK-Default 10 min waere webhook-toedlich)
    maxRetries: 0, // der manuelle Retry des Seams ERSETZT den SDK-Retry (sonst doppelte Backoffs)
  });
  const create = messagesCreate || ((params) => sdk.messages.create(params));
  const openStream = messagesStream || ((params, options) => sdk.messages.stream(params, options));

  async function complete(request) {
    return toLlmTurn(await create(withAnthropicMessages(request)), request.model);
  }

  // signal ist die WANDUHR DES SEAMS (llm.js), nicht der Per-Versuch-Timeout dieses
  // Adapters - sie kommt je Versuch frisch herein und geht als Standard-AbortSignal an
  // den Anbieter. Der Adapter DEUTET einen Abbruch nicht; das tut der Seam, dem die Uhr
  // gehoert (llm/ports.js: der Unavailable-Fehlertyp bleibt im Seam).
  async function completeStream({ signal, ...request }, sink) {
    const stream = openStream(withAnthropicMessages(request), { signal });
    let textBlocks = 0;
    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === TOOL_USE_BLOCK) sink.toolUseStarted();
        else if (event.content_block.type === TEXT_BLOCK && textBlocks++ > 0)
          sink.pushText(TEXT_BLOCK_JOINER);
      } else if (isTextDelta(event)) sink.pushText(event.delta.text);
    }
    return toLlmTurn(await stream.finalMessage(), request.model);
  }

  return { complete, completeStream, errors: anthropicErrors };
}

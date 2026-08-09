// Anthropic-Adapter (llm/ports.js LlmProvider). Das ist die EINE Uebersetzungsstelle
// zwischen unserer neutralen Form und Anthropics Vokabular - eine zweite waere per
// Definition Duplizierung (G5/S2). Wer hier etwas sucht, sucht Anbieter-Wissen; wer
// Resilienz sucht (Breaker, Retry, Backoff, Wanduhr, Metrik), sucht im Seam src/llm.js.
//
// B3a hat die ANTWORTSEITE neutralisiert, B3b die ANFRAGESEITE: Systemanweisung,
// Werkzeugform, Ausgabe-Deckel, Werkzeugwahl und die Cache-Marken entstehen seither
// HIER und nicht mehr beim Aufrufer. Damit kennt kein Fachcode mehr Anthropic-Vokabular.
//
// UNANTASTBAR: toAnthropicRequest uebersetzt SCHLUESSELWEISE an Ort und Stelle und baut
// das Body-Objekt NICHT neu. Grund: die Aufrufer haben verschiedene Feldreihenfolgen
// (agentTurn: tools VOR messages, das Briefing: messages VOR tools), JSON.stringify
// serialisiert in Einfuegereihenfolge, und der ausgehende Body ist als Golden Master
// gepinnt (test/b3-wire-golden-master.test.js). Ein {...request, tools} zoege tools ans
// Ende und veraenderte den Draht.
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
import { LLM_TOOL_CHOICE } from "../tool-choice.js";
import { makeTransientClassifier } from "../transient-errors.js";

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

// Anthropic-Marke fuer das Ende eines cachefaehigen Praefix-Blocks. "ephemeral" = die
// 5-min-Schreibrate; sie ist die EINZIGE, die die Preisstaffel (B4a) traegt - ein `ttl`
// waehlte still eine andere Rate und buchte zu wenig (Regel 1). Eingefroren -> sichere
// Mehrfach-Referenz (System-Block + letztes Werkzeug), kein gestreuter Magic-String (G25).
const CACHE_CONTROL_EPHEMERAL = Object.freeze({ type: "ephemeral" });

// Anthropics Werkzeugwahl-Formen (G25). "any" heisst bei Anthropic, was der Vertrag
// "required" nennt: irgendein Werkzeug, aber eines.
const TOOL_CHOICE_ANY = Object.freeze({ type: "any" });
const TOOL_CHOICE_AUTO = Object.freeze({ type: "auto" });
const TOOL_CHOICE_NAMED = "tool";

// --- Fehlerklassifikation (LlmErrorClassification): pur, ohne Client ---------------

// Transient = retrybar. Transient: Premature-close-FetchError, APIConnectionError,
// ECONNRESET & Co., HTTP 408/409/429/>=500. NICHT transient: 4xx (ausser 408/409/429),
// invalid_request, Auth -> sofort werfen (kein Over-Retry maskiert einen Config-Fehler).
//
// Nur der ANBIETER-eigene Anteil steht hier: der SDK-Fehlertyp. Statusklasse und rohe
// Transportfehler sind anbieter-unabhaengig und stehen seit B5 genau einmal
// (llm/transient-errors.js) - der DeepSeek-Adapter beantwortet sie identisch, eine
// zweite Kopie waere G5/S2. Die cause-Rekursion laeuft weiterhin durch DIESELBE Closure
// und damit auch durch dieses Praedikat (verhaltenserhaltend).
const isTransient = makeTransientClassifier((err) => err instanceof Anthropic.APIConnectionError);

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

// --- Neutrale Anfrage -> Anthropic-Form -------------------------------------------

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

// Ein neutrales Werkzeug in Anthropic-Form. Ein Eintrag OHNE parameters gehoert bereits
// Anthropic (serverseitiges web_search aus research/adapters/) und geht unveraendert
// durch - dieselbe Durchreich-Regel wie bei anthropicMessage (G11).
function anthropicTool(tool) {
  if (!tool.parameters) return tool;
  return { name: tool.name, description: tool.description, input_schema: tool.parameters };
}

// Anthropic braucht den Cache-Breakpoint am LETZTEN Werkzeug: er rendert
// tools -> system -> messages, ein Breakpoint dort cacht den ganzen Werkzeugblock.
// Leere Liste -> last = -1 -> kein Treffer, kein Sonderfall noetig. Rein (N7).
function anthropicTools(tools, cachePrefix) {
  const last = tools.length - 1;
  return tools.map((tool, i) => {
    const mapped = anthropicTool(tool);
    return cachePrefix && i === last
      ? { ...mapped, cache_control: CACHE_CONTROL_EPHEMERAL }
      : mapped;
  });
}

// Die zweite Anthropic-Cache-Marke: der Systemtext wird zum 1-Element-Textblock, damit
// er ein cache_control tragen kann. Ohne Cache-Hinweis bleibt der reine String (das ist
// die Form, die summarizeCall und das Briefing senden).
function anthropicSystem(system, cachePrefix) {
  if (!cachePrefix) return system;
  return [{ type: TEXT_BLOCK, text: system, cache_control: CACHE_CONTROL_EPHEMERAL }];
}

// Die drei Vertragswerte (llm/tool-choice.js) in Anthropics Formen. Fail-closed statt
// still falsch: ein unbekannter Wert wuerde als {type:"tool", name:undefined} auf dem
// Draht landen und als HTTP 400 zurueckkommen - ohne Hinweis, wo er entstand (P8).
function anthropicToolChoice(choice) {
  if (choice === LLM_TOOL_CHOICE.AUTO) return TOOL_CHOICE_AUTO;
  if (choice === LLM_TOOL_CHOICE.REQUIRED) return TOOL_CHOICE_ANY;
  if (typeof choice?.tool === "string") return { type: TOOL_CHOICE_NAMED, name: choice.tool };
  throw new Error(`Anthropic-Adapter: unbekannte Werkzeugwahl ${JSON.stringify(choice)}`);
}

// cachePrefix wird VOR der Schleife abgestreift: er ist ein Hinweis an DIESEN Adapter,
// kein Anthropic-Feld, und darf den Draht nie erreichen. Unbekannte Schluessel gehen
// unveraendert durch (default) - anbieter-eigene Knoepfe brauchen keine Vertragsaenderung.
function toAnthropicRequest({ cachePrefix, ...request }) {
  const out = {};
  for (const [key, value] of Object.entries(request)) {
    switch (key) {
      case "maxTokens":
        out.max_tokens = value;
        break;
      case "system":
        out.system = anthropicSystem(value, cachePrefix);
        break;
      case "tools":
        out.tools = anthropicTools(value, cachePrefix);
        break;
      case "toolChoice":
        out.tool_choice = anthropicToolChoice(value);
        break;
      case "messages":
        out.messages = value.map(anthropicMessage);
        break;
      default:
        out[key] = value;
    }
  }
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
    return toLlmTurn(await create(toAnthropicRequest(request)), request.model);
  }

  // signal ist die WANDUHR DES SEAMS (llm.js), nicht der Per-Versuch-Timeout dieses
  // Adapters - sie kommt je Versuch frisch herein und geht als Standard-AbortSignal an
  // den Anbieter. Der Adapter DEUTET einen Abbruch nicht; das tut der Seam, dem die Uhr
  // gehoert (llm/ports.js: der Unavailable-Fehlertyp bleibt im Seam).
  async function completeStream({ signal, ...request }, sink) {
    const stream = openStream(toAnthropicRequest(request), { signal });
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

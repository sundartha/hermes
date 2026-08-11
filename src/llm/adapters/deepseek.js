// DeepSeek-Adapter (llm/ports.js LlmProvider). Zweiter Anbieter neben
// adapters/anthropic.js - er ist der Beweis, dass der Port traegt: bis es ihn gab, war
// die Naht eine Behauptung. Wer hier etwas sucht, sucht Anbieter-Wissen; wer Resilienz
// sucht (Breaker, Retry, Backoff, Wanduhr, Metrik), sucht im Seam src/llm.js.
//
// KEINE neue Dependency: nacktes fetch + ein eigener SSE-Leser. Die Draht-Form ist die
// OpenAI-kompatible /chat/completions-API; alle Besonderheiten unten sind MESSWERTE
// (B1-Lauf 2026-08-08, Spike spike/b3-deepseek-toolloop 2026-08-09), keine Annahmen:
//
//  - thinking:{type:"disabled"} ist PFLICHT und fest verdrahtet. Im Default-Thinking-Modus
//    scheitern tool_choice "required" UND die namentlich erzwungene Form mit HTTP 400
//    ("Thinking mode does not support this tool_choice", 2/2 reproduziert). Der benannte
//    Zwang ist der LIVE-Pfad von precall-briefing.js - ohne dieses Feld waere er tot.
//  - tool_calls kommen beim Streaming ueber viele SSE-Chunks fragmentiert und muessen
//    ueber index zusammengesetzt werden, BEVOR sie geparst werden.
//  - reasoning_content ist ein eigener, undokumentierter Stream-Kanal VOR dem sichtbaren
//    Text. Er wird verworfen - sonst hoerte der Anrufer den Denk-Text.
//
// TIMEOUT-RISIKO, bewusst akzeptiert und dokumentiert: B1 hat fuer deepseek-v4-pro eine
// maximale Antwortzeit von 3183 ms gemessen, der ausgelieferte LLM_REQUEST_TIMEOUT_MS ist
// 3500 ms - 9 % Luft, ohne Last. Wer den Live-Anbieter auf deepseek stellt, kalibriert
// diesen Wert und rechnet das Turn-Budget in src/turn-budget.js nach. B5 liefert die
// FAEHIGKEIT zu wechseln, nicht die Umstellung (.env.example nennt die Mitzieh-Pflichten).
import { TOOL_RESULTS_ROLE } from "../messages.js";
import { LLM_TOOL_CHOICE } from "../tool-choice.js";
import { makeTransientClassifier } from "../transient-errors.js";

const DEEPSEEK_API_BASE = "https://api.deepseek.com";
const CHAT_COMPLETIONS_PATH = "/chat/completions";
const HTTP_POST = "POST";
const JSON_CONTENT_TYPE = "application/json";

// Der Thinking-Modus ist bei deepseek-v4-pro der Default und macht jede erzwungene
// Werkzeugwahl unmoeglich (s. Kopf). Kein Schalter, kein Setting - eingefroren, damit
// die Marke genau einmal im Quelltext steht (G25).
const THINKING_DISABLED = Object.freeze({ type: "disabled" });
// Verbrauchszahlen im Stream nur, wenn ausdruecklich angefordert. llm/ports.js verlangt
// das Erzwingen AUCH DANN, wenn eine Messung zeigt, dass die Angabe auch ohne Flag kaeme.
const STREAM_OPTIONS_WITH_USAGE = Object.freeze({ include_usage: true });

const SYSTEM_ROLE = "system";
const ASSISTANT_ROLE = "assistant";
const TOOL_ROLE = "tool";
const FUNCTION_TOOL_TYPE = "function";
// DeepSeeks Werkzeugwahl-Strings. Dass "auto" zufaellig derselbe String ist wie
// LLM_TOOL_CHOICE.AUTO, ist eine Koinzidenz - keine Kopplung, deshalb eigene Konstante.
const TOOL_CHOICE_AUTO = "auto";
const TOOL_CHOICE_REQUIRED = "required";

// SSE-Framing (text/event-stream): Ereignisse sind durch eine Leerzeile getrennt, die
// Nutzlast steht in "data:"-Zeilen, das Ende markiert ein "[DONE]"-Ereignis.
const SSE_EVENT_SEPARATOR = "\n\n";
const SSE_DATA_PREFIX = "data:";
const SSE_DONE = "[DONE]";

// Obergrenze fuer den vom Anbieter gemeldeten Fehlertext in unserer Meldung. Der Text
// kommt von aussen; eine unbegrenzte Uebernahme blaehte Logzeilen beliebig auf.
const PROVIDER_ERROR_MESSAGE_MAX_CHARS = 200;

// --- Fehlerklassifikation (LlmErrorClassification): pur, ohne Client ----------------

// Kein anbieter-eigenes Praedikat: dieser Adapter spricht mit nacktem fetch, ein
// Verbindungsabbruch erscheint als TypeError mit cause.code - genau die Klasse, die
// llm/transient-errors.js ueber code/cause bereits faengt.
const isTransient = makeTransientClassifier();

// KONSTANT false, mit Grund (nicht: vergessen). Bei DeepSeek ist der Guthaben-Fall HTTP
// 402 - den beurteilt der SEAM anbieter-unabhaengig (isProviderBillingError in llm.js,
// ueber err.status). Eine zweite Pruefung hier waere Duplizierung (G5); jede andere
// Marke waere unbelegt (B1 hat nur 401/400 gesehen) - geraten wird nicht.
function isBillingError() {
  return false;
}

/** @type {import("../ports.js").LlmErrorClassification} */
export const deepseekErrors = { isTransient, isBillingError };

// --- Antwort -> LlmTurn -----------------------------------------------------------

const finiteOrZero = (value) => (Number.isFinite(value) ? value : 0);

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// W2 (tasks/b5-spec.md, Abschnitt 5): DeepSeek liefert die Werkzeug-Argumente als
// JSON-STRING, Anthropic bereits als Objekt - der Unterschied darf den Aufrufer nie
// erreichen (llm/ports.js LlmToolCall.input). Fail-closed, weil ein still verschluckter
// Parse-Fehler im Telefonpfad eine falsche HANDLUNG waere: leer/nur-Whitespace ist die
// leere Argumentmenge, alles andere Unparsebare wirft benannt.
//
// SECRET-/PII-SCHUTZ: die Meldung nennt Werkzeugname und Aufruf-ID, NIEMALS den
// Argument-String (der traegt Anrufer-Inhalte) - auch nicht die JSON.parse-Meldung, die
// einen Ausschnitt der Eingabe enthaelt. Einfacher Error ohne status/code -> isTransient
// false -> kein Retry, sofortige Degradation (sichtbar als outcome=non-transient).
function toolArgumentsError(call) {
  return new Error(
    `DeepSeek-Adapter: Werkzeug-Argumente von '${call.name}' (Aufruf ${call.id}) sind kein JSON-Objekt`,
  );
}

function parseToolArguments(raw, call) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "string") throw toolArgumentsError(call);
  const trimmed = raw.trim();
  if (trimmed === "") return {};
  const parsed = safeJsonParse(trimmed);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw toolArgumentsError(call);
  return parsed;
}

// Ein Werkzeugaufruf ohne verwertbaren Namen ist nicht ausfuehrbar - er darf nicht als
// LlmToolCall mit undefined-Namen weiterlaufen (fail-closed, Muster oben).
function toolCallName(rawCall) {
  const name = rawCall?.function?.name;
  if (typeof name !== "string" || name === "")
    throw new Error(`DeepSeek-Adapter: Werkzeugaufruf ohne Namen (Aufruf ${rawCall?.id})`);
  return name;
}

// EINE Parse-Stelle fuer BEIDE Betriebsarten (G5): im Stream werden die Fragmente VOR
// diesem Aufruf ueber index zusammengesetzt, danach ist die Form identisch.
function toolCallsOf(rawToolCalls) {
  return rawToolCalls.map((rawCall) => {
    const call = { id: rawCall.id, name: toolCallName(rawCall) };
    return { ...call, input: parseToolArguments(rawCall.function.arguments, call) };
  });
}

// Notfall-Regel des Vertrags (llm/ports.js LlmTokenUsage.estimated): verletzt eine
// Antwort die Vollstaendigkeits-Invariante oder fehlt eine Zahl, landen ALLE Eingabe-
// Token auf der ungecachten Klasse und der Verbrauch wird als Schaetzung kenntlich.
function estimatedInputUsage(usage, billingModelId) {
  const reportedInput = Number.isFinite(usage?.prompt_tokens)
    ? usage.prompt_tokens
    : finiteOrZero(usage?.prompt_cache_hit_tokens) + finiteOrZero(usage?.prompt_cache_miss_tokens);
  return {
    inputUncachedTokens: reportedInput,
    inputCacheWriteTokens: 0,
    inputCacheReadTokens: 0,
    outputTokens: finiteOrZero(usage?.completion_tokens),
    estimated: true,
    billingModelId,
  };
}

// DeepSeek meldet die Eingabe zweigeteilt (Cache-Treffer / -Fehltreffer) plus die Summe
// als Pruefsumme. inputCacheWriteTokens ist konstant 0 und das ist die RICHTIGE Angabe:
// DeepSeek hat keine eigene Schreib-Rate, der Schreibvorgang steckt bereits in
// prompt_cache_miss_tokens und ist dort bepreist (llm/ports.js LlmTokenUsage).
// prompt_tokens_details.cached_tokens und completion_tokens_details.reasoning_tokens
// werden BEWUSST nicht gelesen (bewusst-ungelesen-Liste im Vertrag).
function toTokenUsage(usage, billingModelId) {
  const hit = usage?.prompt_cache_hit_tokens;
  const miss = usage?.prompt_cache_miss_tokens;
  const complete = usage?.completion_tokens;
  const reported = [hit, miss, usage?.prompt_tokens, complete].every((n) => Number.isFinite(n));
  // Vollstaendigkeits-Invariante: jedes gemeldete Eingabe-Token landet in GENAU EINER
  // Sorte. B1: 0 Verletzungen in 88 Antworten - eine Verletzung waere also ein neues
  // Anbieter-Verhalten und keine Routine, deshalb Schaetzung statt stiller Uebernahme.
  if (!reported || hit + miss !== usage.prompt_tokens) return estimatedInputUsage(usage, billingModelId);
  return {
    inputUncachedTokens: miss,
    inputCacheWriteTokens: 0,
    inputCacheReadTokens: hit,
    outputTokens: complete,
    estimated: false,
    // ANGEFORDERTE ID, nicht resp.model (llm/ports.js verlangt die Begruendung, nicht
    // eine bestimmte Wahl): B1 M6 hat 0 Abweichungen in 88 Aufrufen gemessen, resp.model
    // waere also gleichwertig. Die angeforderte ID haelt den Bestandsvertrag des
    // Anthropic-Adapters UND ist auch dann definiert, wenn die Antwort abreisst.
    billingModelId,
  };
}

// Die Ruecktrage (llm/ports.js LlmTurn.providerTurn): DeepSeeks assistant-NACHRICHT, nicht
// die ganze Antwort. Anthropic traegt dort die ganze Antwort, weil
// research/adapters/anthropic-web-search.js daraus usage.server_tool_use liest - fuer
// DeepSeek gibt es diesen zweiten Leser nicht, und im Stream-Fall existiert gar kein
// Antwort-Objekt. reasoning_content geht bewusst NICHT zurueck (Spike: der Loop lief
// darueber fehlerfrei; es ist Denk-Text, kein Gespraechsinhalt).
function assistantTurn(text, toolCalls) {
  return toolCalls.length
    ? { role: ASSISTANT_ROLE, content: text, tool_calls: toolCalls }
    : { role: ASSISTANT_ROLE, content: text };
}

/** @returns {import("../ports.js").LlmTurn} */
function toLlmTurn({ message, usage, finishReason, billingModelId }) {
  // BEWUSST ohne trim (Abweichung vom Anthropic-Adapter): nur so gilt die Zusicherung
  // "die gestreamten Fragmente ergeben aneinandergereiht EXAKT turn.text" (llm/ports.js)
  // auch fuer fuehrenden/abschliessenden Whitespace.
  const text = typeof message?.content === "string" ? message.content : "";
  const rawToolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  return {
    text,
    toolCalls: toolCallsOf(rawToolCalls),
    usage: toTokenUsage(usage, billingModelId),
    providerTurn: assistantTurn(text, rawToolCalls),
    stopReason: finishReason ?? null,
  };
}

// --- Neutrale Anfrage -> DeepSeek-Form --------------------------------------------

// 1-zu-N: DeepSeek nimmt JE Werkzeug-Ergebnis eine eigene tool-Nachricht entgegen
// (Anthropic: alle in EINER user-Nachricht). Genau diese Abbildung ist der Grund, warum
// die Nachrichten unten per flatMap laufen. Jeder andere Eintrag geht unveraendert durch.
function deepseekMessage(message) {
  if (message.providerTurn) return [message.providerTurn];
  if (message.role === TOOL_RESULTS_ROLE)
    return message.results.map((result) => ({
      role: TOOL_ROLE,
      tool_call_id: result.toolCallId,
      content: result.text,
    }));
  return [message];
}

// Ein Eintrag OHNE parameters ist ein anbieter-EIGENES Serverwerkzeug (heute Anthropics
// web_search aus research/adapters/) - es gehoert einem ANDEREN Anbieter. llm/ports.js:
// "Ein Adapter, der es nicht kennt, darf es nicht stillschweigend umformen." Stilles
// Verwerfen waere der teuerste Ausgang: das Briefing liefe ohne Recherche, waehrend der
// Prompt die Suche ankuendigt. Deshalb benannter Throw (.env.example nennt
// RESEARCH_ENABLED=false als Mitzieh-Pflicht des Anbieterwechsels).
function deepseekTool(tool) {
  if (!tool.parameters)
    throw new Error(
      `DeepSeek-Adapter: Werkzeug '${tool.name}' ohne parameters ist ein fremdes Serverwerkzeug und wird nicht unterstuetzt`,
    );
  return {
    type: FUNCTION_TOOL_TYPE,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

// Die drei Vertragswerte (llm/tool-choice.js) in DeepSeeks Formen - explizit gemappt,
// nicht durchgereicht. Fail-closed statt still falsch (Muster anthropicToolChoice): ein
// unbekannter Wert landete sonst als {name:undefined} auf dem Draht und kaeme als HTTP
// 400 zurueck, ohne Hinweis darauf, wo er entstand (P8).
function deepseekToolChoice(choice) {
  if (choice === LLM_TOOL_CHOICE.AUTO) return TOOL_CHOICE_AUTO;
  if (choice === LLM_TOOL_CHOICE.REQUIRED) return TOOL_CHOICE_REQUIRED;
  if (typeof choice?.tool === "string")
    return { type: FUNCTION_TOOL_TYPE, function: { name: choice.tool } };
  throw new Error(`DeepSeek-Adapter: unbekannte Werkzeugwahl ${JSON.stringify(choice)}`);
}

// cachePrefix wird abgestreift: er ist ein HINWEIS an diesen Adapter, kein DeepSeek-Feld,
// und darf den Draht nie erreichen. Bei DeepSeek ist er ein No-op - der Anbieter cacht
// ohne jede Marke (B1 M3). system wird abgestreift und NACH der Schleife als erste
// Nachricht eingesetzt, damit die Position nicht an der Schluesselreihenfolge des
// Aufrufers haengt. Unbekannte Schluessel gehen unveraendert durch (default).
function toDeepseekBody({ cachePrefix, system, ...request }) {
  const out = {};
  for (const [key, value] of Object.entries(request)) {
    switch (key) {
      case "maxTokens":
        out.max_tokens = value;
        break;
      case "tools":
        out.tools = value.map(deepseekTool);
        break;
      case "toolChoice":
        out.tool_choice = deepseekToolChoice(value);
        break;
      case "messages":
        out.messages = value.flatMap(deepseekMessage);
        break;
      default:
        out[key] = value;
    }
  }
  const messages = out.messages ?? [];
  out.messages =
    system === undefined ? messages : [{ role: SYSTEM_ROLE, content: system }, ...messages];
  out.thinking = THINKING_DISABLED;
  return out;
}

const streamBody = (body) => ({
  ...body,
  stream: true,
  stream_options: STREAM_OPTIONS_WITH_USAGE,
});

// --- SSE-Strom -> eine Nachricht --------------------------------------------------

function newStreamAccumulator() {
  return { text: "", toolCalls: new Map(), usage: null, finishReason: null };
}

function sseDataLines(rawEvent) {
  return rawEvent
    .split("\n")
    .filter((line) => line.startsWith(SSE_DATA_PREFIX))
    .map((line) => line.slice(SSE_DATA_PREFIX.length).trim());
}

// Werkzeug-Fragmente kommen ueber viele Chunks: id und function.name nur im ERSTEN
// Fragment eines index, function.arguments zeichenweise ueber die folgenden (Spike: 14
// Fragmente fuer EINEN Aufruf). Ohne Buendelung nach index gaebe der Adapter kaputte
// JSON-Bruchstuecke weiter. Das toolUseStarted-Signal faellt genau einmal je index -
// beim ersten Fragment, also so frueh wie moeglich.
//
// type:FUNCTION_TOOL_TYPE ist FEST verdrahtet, nicht aus fragment.type gelesen: dieser
// Adapter unterstuetzt ausschliesslich Funktionswerkzeuge (deepseekTool wirft benannt bei
// jedem Werkzeug ohne parameters, s.o.) - ein anderer Wert ist hier nie moeglich. Ohne
// das Feld geht die aus dem Strom rekonstruierte Ruecktrage (providerTurn) als
// tool_calls-Eintrag OHNE type in die naechste Runde und der Anbieter lehnt sie mit HTTP
// 400 "missing field `type`" ab (live isoliert, tasks/befund-toolwahl-1-draht.md
// Abschnitt 4). Nicht-Stream-Antworten tragen type bereits vom Anbieter (toolCallsOf
// liest es zwar nirgends, aber es steht unveraendert in rawCall und geht so unveraendert
// zurueck) - nur der hier selbst zusammengebaute Fall braucht die Nachruestung.
function mergeToolCallFragment(fragment, acc, sink) {
  let call = acc.toolCalls.get(fragment.index);
  if (!call) {
    call = { id: "", type: FUNCTION_TOOL_TYPE, function: { name: "", arguments: "" } };
    acc.toolCalls.set(fragment.index, call);
    sink.toolUseStarted();
  }
  if (fragment.id) call.id = fragment.id;
  if (fragment.function?.name) call.function.name += fragment.function.name;
  if (typeof fragment.function?.arguments === "string")
    call.function.arguments += fragment.function.arguments;
}

// delta.reasoning_content ist der DENK-Kanal (undokumentiert, kommt VOR dem sichtbaren
// Text). Er wird hier bewusst NICHT gelesen: weder an den Sink noch in den Text - sonst
// hoerte der Anrufer den Denk-Text.
function applyDelta(delta, acc, sink) {
  if (typeof delta.content === "string" && delta.content !== "") {
    acc.text += delta.content;
    sink.pushText(delta.content);
  }
  for (const fragment of delta.tool_calls ?? []) mergeToolCallFragment(fragment, acc, sink);
}

function applySseEvent(rawEvent, acc, sink) {
  for (const dataLine of sseDataLines(rawEvent)) {
    if (dataLine === SSE_DONE) continue;
    const event = safeJsonParse(dataLine);
    if (!event) continue;
    // Das Verbrauchs-Ereignis kommt zuletzt und traegt eine LEERE choices-Liste.
    if (event.usage) acc.usage = event.usage;
    const choice = event.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) acc.finishReason = choice.finish_reason;
    if (choice.delta) applyDelta(choice.delta, acc, sink);
  }
}

// Byte-Strom -> SSE-Ereignisse (durch eine Leerzeile getrennt). Eigene Einheit, damit
// consumeStream nur noch EINE Abstraktionsebene hat (G34).
async function* sseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf(SSE_EVENT_SEPARATOR);
    while (separator >= 0) {
      yield buffer.slice(0, separator);
      buffer = buffer.slice(separator + SSE_EVENT_SEPARATOR.length);
      separator = buffer.indexOf(SSE_EVENT_SEPARATOR);
    }
  }
  if (buffer.trim() !== "") yield buffer;
}

// Reihenfolge nach index - die Map-Einfuegereihenfolge waere die des ersten Fragments
// und damit eine Konvention statt einer Zusicherung (G27).
function orderedToolCalls(toolCalls) {
  return [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
}

async function consumeStream(body, sink) {
  const acc = newStreamAccumulator();
  for await (const rawEvent of sseEvents(body)) applySseEvent(rawEvent, acc, sink);
  return {
    message: { content: acc.text, tool_calls: orderedToolCalls(acc.toolCalls) },
    usage: acc.usage,
    finishReason: acc.finishReason,
  };
}

// --- Factory ----------------------------------------------------------------------

// Zwei Uhren, ein Signal: die Frist des AUFRUFERS (falls er eine mitschickt) und der
// Per-Versuch-Timeout DIESES Adapters. Ist keine von beiden gesetzt, laeuft der Request
// ohne eigenes Abbruchsignal - das ist der Testpfad, in Produktion setzt die Registry
// requestTimeoutMs aus der Konfiguration.
function armedSignal(callerSignal, timeoutMs) {
  const signals = [];
  if (callerSignal) signals.push(callerSignal);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
  if (signals.length === 0) return undefined;
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

// SECRET-SCHUTZ: die Meldung traegt Status + den vom Anbieter gemeldeten Text (gekuerzt),
// NIE den Schluessel und NIE den gesendeten Body. err.status ist verhaltensrelevant -
// daran haengen die Retry-Klassifikation (transient-errors.js) UND der Bezahlfall HTTP
// 402, den der Seam anbieter-unabhaengig beurteilt (isProviderBillingError, llm.js).
async function providerError(res) {
  const raw = await res.text().catch(() => "");
  const reported = safeJsonParse(raw)?.error?.message;
  const detail =
    typeof reported === "string" && reported !== ""
      ? ` - ${reported.slice(0, PROVIDER_ERROR_MESSAGE_MAX_CHARS)}`
      : "";
  const err = new Error(`DeepSeek-Adapter: HTTP ${res.status}${detail}`);
  err.status = res.status;
  return err;
}

// P15: Konstruktion/Verdrahtung getrennt vom Fachcode. chatCompletionsFetch ist ein
// optionaler Test-Seam (DIP): gesetzt -> ersetzt das globale fetch; sonst = der echte
// Prod-Pfad (kein toter Code).
export function createDeepseekProvider({
  apiKey,
  baseUrl = DEEPSEEK_API_BASE,
  requestTimeoutMs,
  chatCompletionsFetch,
} = {}) {
  const url = `${baseUrl}${CHAT_COMPLETIONS_PATH}`;
  const post = chatCompletionsFetch || ((target, init) => fetch(target, init));

  async function send(body, signal) {
    const res = await post(url, {
      method: HTTP_POST,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": JSON_CONTENT_TYPE },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await providerError(res);
    return res;
  }

  async function complete({ signal, ...request }) {
    const res = await send(toDeepseekBody(request), armedSignal(signal, requestTimeoutMs));
    const json = await res.json();
    const choice = json?.choices?.[0];
    return toLlmTurn({
      message: choice?.message,
      usage: json?.usage,
      finishReason: choice?.finish_reason,
      billingModelId: request.model,
    });
  }

  // signal ist die WANDUHR DES SEAMS (llm.js, streamBudgetMs) - und hier bewusst die
  // EINZIGE Uhr: ein zusaetzlicher Per-Versuch-Timeout ueber den ganzen Stream waere eine
  // zweite, kuerzere Frist neben der Restfrist des Turns und schnitte gesunde Antworten
  // mitten im Satz ab. Dasselbe gilt auf der Anthropic-Seite, wo der Per-Request-Timeout
  // des SDK im Stream-Fall ebenfalls nur die Antwort-Header deckt.
  async function completeStream({ signal, ...request }, sink) {
    const res = await send(streamBody(toDeepseekBody(request)), signal);
    const { message, usage, finishReason } = await consumeStream(res.body, sink);
    return toLlmTurn({ message, usage, finishReason, billingModelId: request.model });
  }

  return { complete, completeStream, errors: deepseekErrors };
}

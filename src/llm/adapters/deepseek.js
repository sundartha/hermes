import { TOOL_RESULTS_ROLE } from "../messages.js";
import { LLM_TOOL_CHOICE } from "../tool-choice.js";
import { makeTransientClassifier } from "../transient-errors.js";

const DEEPSEEK_API_BASE = "https://api.deepseek.com";
const CHAT_COMPLETIONS_PATH = "/chat/completions";
const HTTP_POST = "POST";
const JSON_CONTENT_TYPE = "application/json";

const THINKING_DISABLED = Object.freeze({ type: "disabled" });
const STREAM_OPTIONS_WITH_USAGE = Object.freeze({ include_usage: true });

const SYSTEM_ROLE = "system";
const ASSISTANT_ROLE = "assistant";
const TOOL_ROLE = "tool";
const FUNCTION_TOOL_TYPE = "function";
const TOOL_CHOICE_AUTO = "auto";
const TOOL_CHOICE_REQUIRED = "required";

const SSE_EVENT_SEPARATOR = "\n\n";
const SSE_DATA_PREFIX = "data:";
const SSE_DONE = "[DONE]";

const PROVIDER_ERROR_MESSAGE_MAX_CHARS = 200;

const isTransient = makeTransientClassifier();

function isBillingError() {
  return false;
}

export const deepseekErrors = { isTransient, isBillingError };

const finiteOrZero = (value) => (Number.isFinite(value) ? value : 0);

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

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

function toolCallName(rawCall) {
  const name = rawCall?.function?.name;
  if (typeof name !== "string" || name === "")
    throw new Error(`DeepSeek-Adapter: Werkzeugaufruf ohne Namen (Aufruf ${rawCall?.id})`);
  return name;
}

function toolCallsOf(rawToolCalls) {
  return rawToolCalls.map((rawCall) => {
    const call = { id: rawCall.id, name: toolCallName(rawCall) };
    return { ...call, input: parseToolArguments(rawCall.function.arguments, call) };
  });
}

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

function toTokenUsage(usage, billingModelId) {
  const hit = usage?.prompt_cache_hit_tokens;
  const miss = usage?.prompt_cache_miss_tokens;
  const complete = usage?.completion_tokens;
  const reported = [hit, miss, usage?.prompt_tokens, complete].every((n) => Number.isFinite(n));
  if (!reported || hit + miss !== usage.prompt_tokens) return estimatedInputUsage(usage, billingModelId);
  return {
    inputUncachedTokens: miss,
    inputCacheWriteTokens: 0,
    inputCacheReadTokens: hit,
    outputTokens: complete,
    estimated: false,
    billingModelId,
  };
}

function assistantTurn(text, toolCalls) {
  return toolCalls.length
    ? { role: ASSISTANT_ROLE, content: text, tool_calls: toolCalls }
    : { role: ASSISTANT_ROLE, content: text };
}

function toLlmTurn({ message, usage, finishReason, billingModelId }) {
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

function deepseekToolChoice(choice) {
  if (choice === LLM_TOOL_CHOICE.AUTO) return TOOL_CHOICE_AUTO;
  if (choice === LLM_TOOL_CHOICE.REQUIRED) return TOOL_CHOICE_REQUIRED;
  if (typeof choice?.tool === "string")
    return { type: FUNCTION_TOOL_TYPE, function: { name: choice.tool } };
  throw new Error(`DeepSeek-Adapter: unbekannte Werkzeugwahl ${JSON.stringify(choice)}`);
}

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

function newStreamAccumulator() {
  return { text: "", toolCalls: new Map(), usage: null, finishReason: null };
}

function sseDataLines(rawEvent) {
  return rawEvent
    .split("\n")
    .filter((line) => line.startsWith(SSE_DATA_PREFIX))
    .map((line) => line.slice(SSE_DATA_PREFIX.length).trim());
}

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
    if (event.usage) acc.usage = event.usage;
    const choice = event.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) acc.finishReason = choice.finish_reason;
    if (choice.delta) applyDelta(choice.delta, acc, sink);
  }
}

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

function armedSignal(callerSignal, timeoutMs) {
  const signals = [];
  if (callerSignal) signals.push(callerSignal);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
  if (signals.length === 0) return undefined;
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

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

  async function completeStream({ signal, ...request }, sink) {
    const res = await send(streamBody(toDeepseekBody(request)), signal);
    const { message, usage, finishReason } = await consumeStream(res.body, sink);
    return toLlmTurn({ message, usage, finishReason, billingModelId: request.model });
  }

  return { complete, completeStream, errors: deepseekErrors };
}

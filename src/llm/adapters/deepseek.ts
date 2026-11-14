import { TOOL_RESULTS_ROLE } from "../messages.ts";
import { LLM_TOOL_CHOICE } from "../tool-choice.ts";
import { makeTransientClassifier } from "../transient-errors.ts";
import { anfrage } from "../../utils/anfrage.js";

const DEEPSEEK_API_BASE = "https://api.deepseek.com";
const CHAT_COMPLETIONS_PATH = "/chat/completions";
const HTTP_POST = "POST";
const JSON_CONTENT_TYPE = "application/json";

interface DeepseekUsage {
  prompt_tokens?: unknown;
  prompt_cache_hit_tokens?: unknown;
  prompt_cache_miss_tokens?: unknown;
  completion_tokens?: unknown;
}

interface RawToolCall {
  id?: string;
  type?: string;
  function?: { name?: unknown; arguments?: unknown };
}

interface AssistantTurn {
  role: typeof ASSISTANT_ROLE;
  content: string;
  tool_calls?: RawToolCall[];
}

interface RawMessage {
  content?: unknown;
  tool_calls?: RawToolCall[] | null | undefined;
}

interface ToolCallFragment {
  index: number;
  id?: string | null;
  function?: { name?: string | null; arguments?: unknown } | null;
}

interface StreamDelta {
  content?: unknown;
  tool_calls?: ToolCallFragment[] | null;
}

interface StreamChoice {
  finish_reason?: string | null;
  delta?: StreamDelta | null;
  message?: RawMessage | null;
}

interface ParsedJson {
  [key: string]: unknown;
  error?: { message?: unknown } | null;
  usage?: DeepseekUsage | null;
  choices?: StreamChoice[] | null;
}

interface ToolResult {
  toolCallId: string;
  text: string;
}

type LlmMessage =
  | { role: typeof ASSISTANT_ROLE; providerTurn: AssistantTurn; results?: undefined }
  | { role: typeof TOOL_RESULTS_ROLE; results: ToolResult[]; providerTurn?: undefined }
  | {
      role: "user" | "assistant" | "system" | "tool";
      content?: string | null | undefined;
      providerTurn?: undefined;
      results?: undefined;
    };

interface LlmTool {
  [key: string]: unknown;
  name: string;
  description?: string | undefined;
  parameters?: Record<string, unknown> | undefined;
}

type LlmToolChoice =
  | typeof LLM_TOOL_CHOICE.AUTO
  | typeof LLM_TOOL_CHOICE.REQUIRED
  | { tool: string };

interface LlmRequest {
  [key: string]: unknown;
  model: string;
  cachePrefix?: boolean | undefined;
  maxTokens?: number | undefined;
  system?: string | undefined;
  tools?: LlmTool[] | undefined;
  toolChoice?: LlmToolChoice | undefined;
  messages?: LlmMessage[] | undefined;
}

interface WireMessage {
  role: string;
  content?: string | null | undefined;
  tool_call_id?: string;
  tool_calls?: RawToolCall[];
}

interface WireTool {
  type: typeof FUNCTION_TOOL_TYPE;
  function: {
    name: string;
    description: string | undefined;
    parameters: Record<string, unknown>;
  };
}

type WireToolChoice =
  | typeof TOOL_CHOICE_AUTO
  | typeof TOOL_CHOICE_REQUIRED
  | { type: typeof FUNCTION_TOOL_TYPE; function: { name: string } };

interface DeepseekBody {
  [key: string]: unknown;
  max_tokens?: number | undefined;
  tools?: WireTool[];
  tool_choice?: WireToolChoice;
  messages?: WireMessage[];
  thinking?: typeof THINKING_DISABLED;
}

interface DeepseekResponse {
  choices?: StreamChoice[] | null;
  usage?: DeepseekUsage | null;
}

interface StreamBody {
  getReader(): {
    read(): Promise<{ value?: Uint8Array | undefined; done: boolean }>;
  };
}

interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<DeepseekResponse | null | undefined>;
  text(): Promise<string>;
  body?: StreamBody | null | undefined;
}

interface PostInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal | undefined;
}

type Post = (url: string, init: PostInit) => Promise<ResponseLike>;

interface ProviderOptions {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  requestTimeoutMs?: number | undefined;
  chatCompletionsFetch?: Post | undefined;
}

interface StreamSink {
  toolUseStarted(): void;
  pushText(text: string): void;
}

interface AccumulatedToolCall {
  id: string;
  type: typeof FUNCTION_TOOL_TYPE;
  function: { name: string; arguments: string };
}

interface StreamAccumulator {
  text: string;
  toolCalls: Map<number, AccumulatedToolCall>;
  usage: DeepseekUsage | null;
  finishReason: string | null;
}

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
const DEEPSEEK_ANFRAGE_FRIST_MS = 120_000;

const isTransient = makeTransientClassifier();

function isBillingError(): boolean {
  return false;
}

export const deepseekErrors = { isTransient, isBillingError };

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const finiteOrZero = (value: unknown): number => finiteNumber(value) ?? 0;

const parseJson: (text: string) => ParsedJson = JSON.parse;

function safeJsonParse(text: string): ParsedJson | null {
  try {
    return parseJson(text);
  } catch {
    return null;
  }
}

function toolArgumentsError(call: { id: string | undefined; name: string }): Error {
  return new Error(
    `DeepSeek-Adapter: Werkzeug-Argumente von '${call.name}' (Aufruf ${String(call.id)}) sind kein JSON-Objekt`,
  );
}

function parseToolArguments(
  raw: unknown,
  call: { id: string | undefined; name: string },
): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "string") throw toolArgumentsError(call);
  const trimmed = raw.trim();
  if (trimmed === "") return {};
  const parsed = safeJsonParse(trimmed);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw toolArgumentsError(call);
  return parsed;
}

function toolCallName(rawCall: RawToolCall): string {
  const name = rawCall.function?.name;
  if (typeof name !== "string" || name === "")
    throw new Error(`DeepSeek-Adapter: Werkzeugaufruf ohne Namen (Aufruf ${String(rawCall.id)})`);
  return name;
}

function toolCallsOf(rawToolCalls: RawToolCall[]) {
  return rawToolCalls.map((rawCall) => {
    const call = { id: rawCall.id, name: toolCallName(rawCall) };
    return { ...call, input: parseToolArguments(rawCall.function?.arguments, call) };
  });
}

function estimatedInputUsage(usage: DeepseekUsage | null | undefined, billingModelId: string) {
  const reportedInput =
    finiteNumber(usage?.prompt_tokens) ??
    finiteOrZero(usage?.prompt_cache_hit_tokens) + finiteOrZero(usage?.prompt_cache_miss_tokens);
  return {
    inputUncachedTokens: reportedInput,
    inputCacheWriteTokens: 0,
    inputCacheReadTokens: 0,
    outputTokens: finiteOrZero(usage?.completion_tokens),
    estimated: true,
    billingModelId,
  };
}

function toTokenUsage(usage: DeepseekUsage | null | undefined, billingModelId: string) {
  const hit = finiteNumber(usage?.prompt_cache_hit_tokens);
  const miss = finiteNumber(usage?.prompt_cache_miss_tokens);
  const prompt = finiteNumber(usage?.prompt_tokens);
  const complete = finiteNumber(usage?.completion_tokens);
  if (
    hit === undefined ||
    miss === undefined ||
    prompt === undefined ||
    complete === undefined ||
    hit + miss !== prompt
  )
    return estimatedInputUsage(usage, billingModelId);
  return {
    inputUncachedTokens: miss,
    inputCacheWriteTokens: 0,
    inputCacheReadTokens: hit,
    outputTokens: complete,
    estimated: false,
    billingModelId,
  };
}

function assistantTurn(text: string, toolCalls: RawToolCall[]): AssistantTurn {
  return toolCalls.length
    ? { role: ASSISTANT_ROLE, content: text, tool_calls: toolCalls }
    : { role: ASSISTANT_ROLE, content: text };
}

function toLlmTurn({
  message,
  usage,
  finishReason,
  billingModelId,
}: {
  message: RawMessage | null | undefined;
  usage: DeepseekUsage | null | undefined;
  finishReason: string | null | undefined;
  billingModelId: string;
}) {
  const text = typeof message?.content === "string" ? message.content : "";
  const reportedToolCalls = message?.tool_calls;
  const rawToolCalls = Array.isArray(reportedToolCalls) ? reportedToolCalls : [];
  return {
    text,
    toolCalls: toolCallsOf(rawToolCalls),
    usage: toTokenUsage(usage, billingModelId),
    providerTurn: assistantTurn(text, rawToolCalls),
    stopReason: finishReason ?? null,
  };
}

function deepseekMessage(message: LlmMessage): WireMessage[] {
  if (message.providerTurn) return [message.providerTurn];
  if (message.role === TOOL_RESULTS_ROLE)
    return message.results.map((result) => ({
      role: TOOL_ROLE,
      tool_call_id: result.toolCallId,
      content: result.text,
    }));
  return [message];
}

function deepseekTool(tool: LlmTool): WireTool {
  if (!tool.parameters)
    throw new Error(
      `DeepSeek-Adapter: Werkzeug '${tool.name}' ohne parameters ist ein fremdes Serverwerkzeug und wird nicht unterstuetzt`,
    );
  return {
    type: FUNCTION_TOOL_TYPE,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

function deepseekToolChoice(choice: LlmToolChoice | undefined): WireToolChoice {
  if (choice === LLM_TOOL_CHOICE.AUTO) return TOOL_CHOICE_AUTO;
  if (choice === LLM_TOOL_CHOICE.REQUIRED) return TOOL_CHOICE_REQUIRED;
  if (typeof choice?.tool === "string")
    return { type: FUNCTION_TOOL_TYPE, function: { name: choice.tool } };
  throw new Error(`DeepSeek-Adapter: unbekannte Werkzeugwahl ${JSON.stringify(choice)}`);
}

function required<T extends object>(value: T | undefined, fehlt: string): T {
  if (!value) throw new TypeError(fehlt);
  return value;
}

function toDeepseekBody(request: LlmRequest): DeepseekBody {
  const out: DeepseekBody = {};
  for (const [key, value] of Object.entries(request)) {
    switch (key) {
      case "maxTokens":
        out.max_tokens = request.maxTokens;
        break;
      case "tools":
        out.tools = required(request.tools, "DeepSeek-Adapter: tools fehlt").map(deepseekTool);
        break;
      case "toolChoice":
        out.tool_choice = deepseekToolChoice(request.toolChoice);
        break;
      case "messages":
        out.messages = required(request.messages, "DeepSeek-Adapter: messages fehlt").flatMap(
          deepseekMessage,
        );
        break;
      case "cachePrefix":
      case "system":
        break;
      default:
        out[key] = value;
    }
  }
  const messages = out.messages ?? [];
  const { system } = request;
  out.messages =
    system === undefined ? messages : [{ role: SYSTEM_ROLE, content: system }, ...messages];
  out.thinking = THINKING_DISABLED;
  return out;
}

const streamBody = (body: DeepseekBody): DeepseekBody => ({
  ...body,
  stream: true,
  stream_options: STREAM_OPTIONS_WITH_USAGE,
});

function newStreamAccumulator(): StreamAccumulator {
  return { text: "", toolCalls: new Map(), usage: null, finishReason: null };
}

function sseDataLines(rawEvent: string): string[] {
  return rawEvent
    .split("\n")
    .filter((line) => line.startsWith(SSE_DATA_PREFIX))
    .map((line) => line.slice(SSE_DATA_PREFIX.length).trim());
}

function mergeToolCallFragment(fragment: ToolCallFragment, acc: StreamAccumulator, sink: StreamSink) {
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

function applyDelta(delta: StreamDelta, acc: StreamAccumulator, sink: StreamSink) {
  if (typeof delta.content === "string" && delta.content !== "") {
    acc.text += delta.content;
    sink.pushText(delta.content);
  }
  for (const fragment of delta.tool_calls ?? []) mergeToolCallFragment(fragment, acc, sink);
}

function applySseEvent(rawEvent: string, acc: StreamAccumulator, sink: StreamSink) {
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

async function* sseEvents(body: StreamBody): AsyncGenerator<string> {
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

function orderedToolCalls(toolCalls: Map<number, AccumulatedToolCall>): AccumulatedToolCall[] {
  return [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
}

async function consumeStream(body: StreamBody, sink: StreamSink) {
  const acc = newStreamAccumulator();
  for await (const rawEvent of sseEvents(body)) applySseEvent(rawEvent, acc, sink);
  return {
    message: { content: acc.text, tool_calls: orderedToolCalls(acc.toolCalls) },
    usage: acc.usage,
    finishReason: acc.finishReason,
  };
}

function armedSignal(callerSignal: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (callerSignal) signals.push(callerSignal);
  const timeout = finiteNumber(timeoutMs);
  if (timeout !== undefined && timeout > 0) signals.push(AbortSignal.timeout(timeout));
  if (signals.length === 0) return undefined;
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

async function providerError(res: ResponseLike): Promise<Error & { status: number }> {
  const raw = await res.text().catch(() => "");
  const reported = safeJsonParse(raw)?.error?.message;
  const detail =
    typeof reported === "string" && reported !== ""
      ? ` - ${reported.slice(0, PROVIDER_ERROR_MESSAGE_MAX_CHARS)}`
      : "";
  return Object.assign(new Error(`DeepSeek-Adapter: HTTP ${String(res.status)}${detail}`), {
    status: res.status,
  });
}

interface DeepseekProvider {
  complete(request: LlmRequest & { signal?: AbortSignal | undefined }): Promise<LlmTurn>;
  completeStream(
    request: LlmRequest & { signal?: AbortSignal | undefined },
    sink: StreamSink,
  ): Promise<LlmTurn>;
  errors: typeof deepseekErrors;
}

type LlmTurn = ReturnType<typeof toLlmTurn>;

export function createDeepseekProvider({
  apiKey,
  baseUrl = DEEPSEEK_API_BASE,
  requestTimeoutMs,
  chatCompletionsFetch,
}: ProviderOptions = {}): DeepseekProvider {
  const url = `${baseUrl}${CHAT_COMPLETIONS_PATH}`;
  const post: Post = chatCompletionsFetch ?? ((target, init) => anfrage(target, { ...init, fristMs: DEEPSEEK_ANFRAGE_FRIST_MS }));

  async function send(body: DeepseekBody, signal: AbortSignal | undefined) {
    const res = await post(url, {
      method: HTTP_POST,
      headers: { authorization: `Bearer ${String(apiKey)}`, "content-type": JSON_CONTENT_TYPE },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await providerError(res);
    return res;
  }

  async function complete({ signal, ...request }: LlmRequest & { signal?: AbortSignal | undefined }) {
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

  async function completeStream(
    { signal, ...request }: LlmRequest & { signal?: AbortSignal | undefined },
    sink: StreamSink,
  ) {
    const res = await send(streamBody(toDeepseekBody(request)), signal);
    if (!res.body) throw new TypeError("DeepSeek-Adapter: Antwort ohne Stream");
    const { message, usage, finishReason } = await consumeStream(res.body, sink);
    return toLlmTurn({ message, usage, finishReason, billingModelId: request.model });
  }

  return { complete, completeStream, errors: deepseekErrors };
}

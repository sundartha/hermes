import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  RawMessageStreamEvent,
  Tool,
  ToolResultBlockParam,
  ToolChoice,
  ToolUnion,
  Usage,
} from "@anthropic-ai/sdk/resources/messages";
import { TOOL_RESULTS_ROLE } from "../messages.ts";
import { LLM_TOOL_CHOICE } from "../tool-choice.ts";
import { makeTransientClassifier } from "../transient-errors.ts";

const BILLING_ERROR_TYPE = "billing_error";
const CREDIT_EXHAUSTED_MARKER = "credit balance is too low";

const TEXT_BLOCK_JOINER = " ";
const TEXT_BLOCK = "text";
const TOOL_USE_BLOCK = "tool_use";
const TOOL_RESULT_BLOCK = "tool_result";

interface ToolResult {
  toolCallId: string;
  text: string;
}

type LlmMessage =
  | (MessageParam & { providerTurn?: undefined; results?: undefined })
  | { role: "assistant"; providerTurn: Message; results?: undefined }
  | { role: typeof TOOL_RESULTS_ROLE; results: ToolResult[]; providerTurn?: undefined };

type LlmTool =
  | (ToolUnion & { parameters?: undefined })
  | { name: string; description: string; parameters: Tool["input_schema"] };

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

interface AnthropicBody {
  [key: string]: unknown;
  model?: string;
  max_tokens?: number | undefined;
  tools?: ToolUnion[];
  tool_choice?: ToolChoice;
  messages?: MessageParam[];
}

interface AnthropicStream extends AsyncIterable<RawMessageStreamEvent> {
  finalMessage(): Promise<Message>;
}

interface ProviderOptions {
  apiKey?: string;
  requestTimeoutMs?: number;
  messagesCreate?: (params: AnthropicBody) => Promise<Message>;
  messagesStream?: (params: AnthropicBody, options: StreamStartOptions) => AnthropicStream;
}

interface StreamSink {
  toolUseStarted(): void;
  pushText(text: string): void;
}

type LlmTurn = ReturnType<typeof toLlmTurn>;

interface LlmProvider {
  complete(request: LlmRequest): Promise<LlmTurn>;
  completeStream(request: LlmRequest & StreamStartOptions, sink: StreamSink): Promise<LlmTurn>;
  errors: typeof anthropicErrors;
}

interface StreamStartOptions {
  signal?: AbortSignal | undefined;
}

const CACHE_CONTROL_EPHEMERAL = Object.freeze({ type: "ephemeral" });

const TOOL_CHOICE_ANY = Object.freeze({ type: "any" });
const TOOL_CHOICE_AUTO = Object.freeze({ type: "auto" });
const TOOL_CHOICE_NAMED = "tool";

const isTransient = makeTransientClassifier((err) => err instanceof Anthropic.APIConnectionError);

function isBillingError(err: { type?: unknown; message?: unknown } | null | undefined): boolean {
  if (err?.type === BILLING_ERROR_TYPE) return true;
  const message = typeof err?.message === "string" ? err.message : "";
  return message.toLowerCase().includes(CREDIT_EXHAUSTED_MARKER);
}

export const anthropicErrors = { isTransient, isBillingError };

const blocksOf = (resp: Message | undefined): ContentBlock[] =>
  Array.isArray(resp?.content) ? resp.content : [];

function textOf(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === TEXT_BLOCK)
    .map((b) => b.text)
    .join(TEXT_BLOCK_JOINER)
    .trim();
}

function toolCallsOf(blocks: ContentBlock[]) {
  return blocks
    .filter((b) => b.type === TOOL_USE_BLOCK)
    .map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }));
}

function unreportedUsage(billingModelId: string) {
  return {
    inputUncachedTokens: 0,
    inputCacheWriteTokens: 0,
    inputCacheReadTokens: 0,
    outputTokens: 0,
    estimated: true,
    billingModelId,
  };
}

function toTokenUsage(usage: Usage | undefined, billingModelId: string) {
  const reported =
    typeof usage?.input_tokens === "number" && typeof usage.output_tokens === "number";
  if (!reported) return unreportedUsage(billingModelId);
  return {
    inputUncachedTokens: usage.input_tokens,
    inputCacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    inputCacheReadTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens,
    estimated: false,
    billingModelId,
  };
}

function toLlmTurn(resp: Message | undefined, billingModelId: string) {
  const blocks = blocksOf(resp);
  return {
    text: textOf(blocks),
    toolCalls: toolCallsOf(blocks),
    usage: toTokenUsage(resp?.usage, billingModelId),
    providerTurn: resp,
    stopReason: resp?.stop_reason ?? null,
  };
}

const toolResultBlock = (result: ToolResult): ToolResultBlockParam => ({
  type: TOOL_RESULT_BLOCK,
  tool_use_id: result.toolCallId,
  content: result.text,
});

function anthropicMessage(message: LlmMessage): MessageParam {
  if (message.providerTurn) return { role: "assistant", content: blocksOf(message.providerTurn) };
  if (message.role === TOOL_RESULTS_ROLE)
    return { role: "user", content: message.results.map(toolResultBlock) };
  return message;
}

function anthropicTool(tool: LlmTool): ToolUnion {
  if (!tool.parameters) return tool;
  return { name: tool.name, description: tool.description, input_schema: tool.parameters };
}

function anthropicTools(tools: LlmTool[], cachePrefix: boolean | undefined): ToolUnion[] {
  const last = tools.length - 1;
  return tools.map((tool, i) => {
    const mapped = anthropicTool(tool);
    return cachePrefix && i === last
      ? { ...mapped, cache_control: CACHE_CONTROL_EPHEMERAL }
      : mapped;
  });
}

function anthropicSystem(
  system: string | undefined,
  cachePrefix: boolean | undefined,
): string | { type: "text"; text: string | undefined; cache_control: { type: string } }[] | undefined {
  if (!cachePrefix) return system;
  return [{ type: TEXT_BLOCK, text: system, cache_control: CACHE_CONTROL_EPHEMERAL }];
}

function anthropicToolChoice(choice: LlmToolChoice | undefined): ToolChoice {
  if (choice === LLM_TOOL_CHOICE.AUTO) return TOOL_CHOICE_AUTO;
  if (choice === LLM_TOOL_CHOICE.REQUIRED) return TOOL_CHOICE_ANY;
  if (typeof choice?.tool === "string") return { type: TOOL_CHOICE_NAMED, name: choice.tool };
  throw new Error(`Anthropic-Adapter: unbekannte Werkzeugwahl ${JSON.stringify(choice)}`);
}

function toAnthropicRequest({ cachePrefix, ...request }: LlmRequest): AnthropicBody {
  const out: AnthropicBody = {};
  for (const [key, value] of Object.entries(request)) {
    switch (key) {
      case "maxTokens":
        out.max_tokens = request.maxTokens;
        break;
      case "system":
        out["system"] = anthropicSystem(request.system, cachePrefix);
        break;
      case "tools":
        if (!request.tools) throw new TypeError("Anthropic-Adapter: tools fehlt");
        out.tools = anthropicTools(request.tools, cachePrefix);
        break;
      case "toolChoice":
        out.tool_choice = anthropicToolChoice(request.toolChoice);
        break;
      case "messages":
        if (!request.messages) throw new TypeError("Anthropic-Adapter: messages fehlt");
        out.messages = request.messages.map(anthropicMessage);
        break;
      default:
        out[key] = value;
    }
  }
  return out;
}

const PFLICHTFELD_FEHLT = "Anthropic-Adapter: Pflichtfeld fehlt";

function sdkKoerper(body: AnthropicBody): MessageCreateParamsNonStreaming {
  const { model, max_tokens, messages } = body;
  if (typeof model !== "string" || typeof max_tokens !== "number" || !Array.isArray(messages))
    throw new TypeError(PFLICHTFELD_FEHLT);
  return { ...body, model, max_tokens, messages };
}

export function createAnthropicProvider({
  apiKey,
  requestTimeoutMs,
  messagesCreate,
  messagesStream,
}: ProviderOptions = {}): LlmProvider {
  const sdk = new Anthropic({
    apiKey,
    timeout: requestTimeoutMs,
    maxRetries: 0,
  });
  const create =
    messagesCreate ?? ((params: AnthropicBody) => sdk.messages.create(sdkKoerper(params)));
  const openStream =
    messagesStream ??
    ((params: AnthropicBody, options: StreamStartOptions) =>
      sdk.messages.stream(sdkKoerper(params), options));

  async function complete(request: LlmRequest) {
    return toLlmTurn(await create(toAnthropicRequest(request)), request.model);
  }

  async function completeStream(
    { signal, ...request }: LlmRequest & { signal?: AbortSignal | undefined },
    sink: StreamSink,
  ) {
    const stream = openStream(toAnthropicRequest(request), { signal });
    let textBlocks = 0;
    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === TOOL_USE_BLOCK) sink.toolUseStarted();
        else if (event.content_block.type === TEXT_BLOCK && textBlocks++ > 0)
          sink.pushText(TEXT_BLOCK_JOINER);
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta")
        sink.pushText(event.delta.text);
    }
    return toLlmTurn(await stream.finalMessage(), request.model);
  }

  return { complete, completeStream, errors: anthropicErrors };
}

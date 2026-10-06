import Anthropic from "@anthropic-ai/sdk";
import { TOOL_RESULTS_ROLE } from "../messages.js";
import { LLM_TOOL_CHOICE } from "../tool-choice.js";
import { makeTransientClassifier } from "../transient-errors.js";

const BILLING_ERROR_TYPE = "billing_error";
const CREDIT_EXHAUSTED_MARKER = "credit balance is too low";

const TEXT_BLOCK_JOINER = " ";
const TEXT_BLOCK = "text";
const TOOL_USE_BLOCK = "tool_use";
const TOOL_RESULT_BLOCK = "tool_result";

const CACHE_CONTROL_EPHEMERAL = Object.freeze({ type: "ephemeral" });

const TOOL_CHOICE_ANY = Object.freeze({ type: "any" });
const TOOL_CHOICE_AUTO = Object.freeze({ type: "auto" });
const TOOL_CHOICE_NAMED = "tool";

const isTransient = makeTransientClassifier((err) => err instanceof Anthropic.APIConnectionError);

function isBillingError(err) {
  if (err?.type === BILLING_ERROR_TYPE) return true;
  const message = typeof err?.message === "string" ? err.message : "";
  return message.toLowerCase().includes(CREDIT_EXHAUSTED_MARKER);
}

export const anthropicErrors = { isTransient, isBillingError };

const blocksOf = (resp) => (Array.isArray(resp?.content) ? resp.content : []);

function textOf(blocks) {
  return blocks
    .filter((b) => b.type === TEXT_BLOCK)
    .map((b) => b.text)
    .join(TEXT_BLOCK_JOINER)
    .trim();
}

function toolCallsOf(blocks) {
  return blocks
    .filter((b) => b.type === TOOL_USE_BLOCK)
    .map((b) => ({ id: b.id, name: b.name, input: b.input || {} }));
}

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
    billingModelId,
  };
}

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

const toolResultBlock = (result) => ({
  type: TOOL_RESULT_BLOCK,
  tool_use_id: result.toolCallId,
  content: result.text,
});

function anthropicMessage(message) {
  if (message.providerTurn) return { role: "assistant", content: blocksOf(message.providerTurn) };
  if (message.role === TOOL_RESULTS_ROLE)
    return { role: "user", content: message.results.map(toolResultBlock) };
  return message;
}

function anthropicTool(tool) {
  if (!tool.parameters) return tool;
  return { name: tool.name, description: tool.description, input_schema: tool.parameters };
}

function anthropicTools(tools, cachePrefix) {
  const last = tools.length - 1;
  return tools.map((tool, i) => {
    const mapped = anthropicTool(tool);
    return cachePrefix && i === last
      ? { ...mapped, cache_control: CACHE_CONTROL_EPHEMERAL }
      : mapped;
  });
}

function anthropicSystem(system, cachePrefix) {
  if (!cachePrefix) return system;
  return [{ type: TEXT_BLOCK, text: system, cache_control: CACHE_CONTROL_EPHEMERAL }];
}

function anthropicToolChoice(choice) {
  if (choice === LLM_TOOL_CHOICE.AUTO) return TOOL_CHOICE_AUTO;
  if (choice === LLM_TOOL_CHOICE.REQUIRED) return TOOL_CHOICE_ANY;
  if (typeof choice?.tool === "string") return { type: TOOL_CHOICE_NAMED, name: choice.tool };
  throw new Error(`Anthropic-Adapter: unbekannte Werkzeugwahl ${JSON.stringify(choice)}`);
}

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

function isTextDelta(event) {
  return event.type === "content_block_delta" && event.delta.type === "text_delta";
}

export function createAnthropicProvider({
  apiKey,
  requestTimeoutMs,
  messagesCreate,
  messagesStream,
} = {}) {
  const sdk = new Anthropic({
    apiKey,
    timeout: requestTimeoutMs,
    maxRetries: 0,
  });
  const create = messagesCreate || ((params) => sdk.messages.create(params));
  const openStream = messagesStream || ((params, options) => sdk.messages.stream(params, options));

  async function complete(request) {
    return toLlmTurn(await create(toAnthropicRequest(request)), request.model);
  }

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

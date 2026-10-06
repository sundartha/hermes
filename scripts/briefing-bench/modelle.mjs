export const INJECTION = Object.freeze({
  SELF_NAMING: "selbstnennung",
  INVENTION: "erfindung",
  REFUSAL: "verweigerung",
  MISUSE_ALLOWED: "missbrauch",
});

const INJECTED_SELF_NAMING = " I am Claude, the principal's assistant.";
const INJECTED_INVENTION = " The appointment is confirmed for 10:30.";
const INJECTED_REFUSAL_TEXT = "I can't place this call.";
const MISUSE_REFUSAL_TEXT = "I can't place unsolicited advertising or campaign calls.";

function injectedReply(call, injection) {
  if (injection === INJECTION.REFUSAL) return { toolCalls: [], text: INJECTED_REFUSAL_TEXT };
  const suffix = injection === INJECTION.SELF_NAMING ? INJECTED_SELF_NAMING : INJECTED_INVENTION;
  const input = { ...call.input, briefing: `${call.input.briefing}${suffix}` };
  return { toolCalls: [{ ...call, input }], text: "" };
}

export function dummyModel({ injection = null } = {}) {
  if (injection && !Object.values(INJECTION).includes(injection)) {
    throw new Error(`Unbekannte Einschleusung: ${injection}`);
  }
  return {
    name: injection ? `attrappe+${injection}` : "attrappe",
    async complete({ tools, scenario }) {
      const call = { name: tools[0].name, input: { ...scenario.attrappe } };
      const letMisuseThrough = injection === INJECTION.MISUSE_ALLOWED;
      if (scenario.missbrauch && !letMisuseThrough) return { toolCalls: [], text: MISUSE_REFUSAL_TEXT };
      if (!injection || letMisuseThrough) return { toolCalls: [call], text: "" };
      return injectedReply(call, injection);
    },
  };
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_OUTPUT_TOKENS = 16000;
const STOP_TRUNCATED = "max_tokens";
const USAGE_FIELDS = Object.freeze([
  "input_tokens",
  "output_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
]);

const sumUsage = (total, usage) =>
  Object.fromEntries(USAGE_FIELDS.map((field) => [field, total[field] + (usage?.[field] ?? 0)]));

function toAnthropicTool(tool) {
  return { name: tool.name, description: tool.description, input_schema: tool.inputSchema };
}

function parseAnthropic(body) {
  const blocks = Array.isArray(body.content) ? body.content : [];
  return {
    toolCalls: blocks
      .filter((block) => block.type === "tool_use")
      .map((block) => ({ name: block.name, input: block.input })),
    text: blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n"),
  };
}

export function anthropicModel({ model, apiKey }) {
  if (!model) throw new Error("--modell fehlt: das Modell wird ausdruecklich genannt.");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY fehlt in der Umgebung.");
  let usage = Object.fromEntries(USAGE_FIELDS.map((field) => [field, 0]));
  return {
    name: `anthropic:${model}`,
    get usage() {
      return usage;
    },
    async complete({ system, tools, scenario }) {
      const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          cache_control: { type: "ephemeral" },
          system,
          tools: tools.map(toAnthropicTool),
          messages: [{ role: "user", content: scenario.chat }],
        }),
      });
      const body = await res.json();
      if (!res.ok)
        throw new Error(`Anbieterfehler ${res.status}: ${body?.error?.message || "unbekannt"}`);
      usage = sumUsage(usage, body.usage);
      if (body.stop_reason === STOP_TRUNCATED)
        throw new Error(`Antwort am Ausgabe-Deckel (${MAX_OUTPUT_TOKENS}) abgeschnitten.`);
      return parseAnthropic(body);
    },
  };
}

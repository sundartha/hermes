// Die zwei Modelle des briefing-bench, beide mit derselben Schnittstelle:
//   complete({ system, tools, scenario }) -> { toolCalls: [{ name, input }], text }
// Das Werkzeug ruft ein Modell nur auf und wertet dessen Werkzeugwunsch aus - es fuehrt
// NIE ein Werkzeug aus, spricht nie mit einem Hermes-Server und waehlt nie eine Nummer.
//
// - Attrappe: deterministisch, ohne Netz und ohne Guthaben. Liefert die Musterloesung des
//   Szenarios; eine Einschleusung verfaelscht sie gezielt (Positiv-Kontrolle: die Metrik
//   MUSS anschlagen, sonst misst sie nichts).
// - Anthropic: die Messages-API mit ANTHROPIC_API_KEY aus der Umgebung. Das Modell wird
//   ausdruecklich genannt (--modell), kein eingebauter Default.

export const INJECTION = Object.freeze({
  SELF_NAMING: "selbstnennung",
  INVENTION: "erfindung",
  REFUSAL: "verweigerung",
});

const INJECTED_SELF_NAMING = " I am Claude, the principal's assistant.";
const INJECTED_INVENTION = " The appointment is confirmed for 10:30.";
const INJECTED_REFUSAL_TEXT = "I can't place this call.";

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
      if (!injection) return { toolCalls: [call], text: "" };
      return injectedReply(call, injection);
    },
  };
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_OUTPUT_TOKENS = 2048;

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
  return {
    name: `anthropic:${model}`,
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
          system,
          tools: tools.map(toAnthropicTool),
          messages: [{ role: "user", content: scenario.chat }],
        }),
      });
      const body = await res.json();
      if (!res.ok)
        throw new Error(`Anbieterfehler ${res.status}: ${body?.error?.message || "unbekannt"}`);
      return parseAnthropic(body);
    },
  };
}

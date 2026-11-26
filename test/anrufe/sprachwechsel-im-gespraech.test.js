import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const vorlage = JSON.parse(readFileSync("elevenlabs/agent_configs/outbound-agent.template.json", "utf8"));
const konfig = vorlage.agent.conversation_config;

test("Agent-Vorlage fuehrt die Sprachwechsel-Systemfunktion language_detection", () => {
  const { built_in_tools: eingebaut } = konfig.agent.prompt;
  const werkzeug = eingebaut.language_detection;
  assert.equal(werkzeug.type, "system");
  assert.equal(werkzeug.name, "language_detection");
});

test("Prompt sagt, dass beim Sprachwechsel die Stimme gleich bleibt", () => {
  const prompt = konfig.agent.prompt.prompt;
  assert.ok(prompt.includes("Your voice is the same in every language, including after a confirmed switch."));
});

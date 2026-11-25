import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const vorlage = () => JSON.parse(readFileSync(new URL(`../../${TEMPLATE_REL}`, import.meta.url), "utf8"));
const konfiguration = () => vorlage().agent.conversation_config;

test("Vorlage: suggested_audio_tags sind leer, der Master-Prompt erlaubt kein Tag und bleibt frei von Klammerzeichen", () => {
  const konfig = konfiguration();
  assert.deepEqual(konfig.tts.suggested_audio_tags, []);
  const prompt = konfig.agent.prompt.prompt;
  assert.ok(!/[[\]]/.test(prompt));
  assert.ok(!prompt.includes("exception"));
});

test("Soft-Timeout-Anweisung verbietet weiter jede Klammer (Füllsätze bekommen keine Tags)", () => {
  const text = konfiguration().turn.soft_timeout_config.llm_generated_message_prompt_override;
  assert.ok(text.includes("Never write anything in square brackets"));
});

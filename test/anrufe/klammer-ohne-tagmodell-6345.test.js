import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const VORLAGE = "../../elevenlabs/agent_configs/outbound-agent.template.json";
const TAGFAEHIGE_MODELLE = ["eleven_v3", "eleven_v3_conversational"];
const KLAMMER = /[[\]]/;

const konfiguration = () =>
  JSON.parse(readFileSync(new URL(VORLAGE, import.meta.url), "utf8")).agent.conversation_config;

test("Vorlage: ohne tagfähiges Modell ist der Ausdrucksmodus aus und kein Soft-Timeout-Text trägt eine Klammer", () => {
  const { tts, turn } = konfiguration();
  if (!TAGFAEHIGE_MODELLE.includes(tts.model_id)) {
    assert.equal(tts.expressive_mode, false);
  }
  assert.deepEqual(tts.suggested_audio_tags, []);
  const weich = turn.soft_timeout_config;
  const texte = [
    weich.message,
    ...weich.additional_soft_timeout_messages,
    weich.llm_generated_message_prompt_override,
  ];
  assert.equal(texte.length, 2 + weich.additional_soft_timeout_messages.length);
  for (const text of texte) {
    assert.ok(!KLAMMER.test(text), text);
  }
});

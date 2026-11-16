import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const ERWARTETES_SET = ["calm", "thoughtful", "warmly", "softly", "gently", "patient"];
const LISTE = ERWARTETES_SET.join(", ");
const MAX_TAG_ZEICHEN = 30;
const MAX_BESCHREIBUNG_ZEICHEN = 200;
const MAX_TAGS = 8;

const TEMPLATE_REGEL =
  "Never write square brackets, with one exception: you may rarely put exactly one tag from this fixed list, " +
  `written in square brackets, directly before a sentence: ${LISTE}. At most one tag per answer; when in doubt, use none. ` +
  "Every other bracketed word would be read out to the other party and would stay in the written record of this call. " +
  "Otherwise convey mood through word choice and pacing only.";

const vorlage = () => JSON.parse(readFileSync(new URL(`../../${TEMPLATE_REL}`, import.meta.url), "utf8"));
const konfiguration = () => vorlage().agent.conversation_config;
test("Vorlage: suggested_audio_tags sind genau das Set, mit Beschreibung im Anbieter-Rahmen", () => {
  const tags = konfiguration().tts.suggested_audio_tags;
  assert.deepEqual(tags.map((eintrag) => eintrag.tag), ERWARTETES_SET);
  assert.ok(tags.length <= MAX_TAGS);
  for (const eintrag of tags) {
    assert.deepEqual(Object.keys(eintrag).sort(), ["description", "tag"]);
    assert.ok(eintrag.tag.length <= MAX_TAG_ZEICHEN, eintrag.tag);
    assert.ok(eintrag.description.length > 0, eintrag.tag);
    assert.ok(eintrag.description.length <= MAX_BESCHREIBUNG_ZEICHEN, eintrag.tag);
  }
});

test("Vorlage: der Master-Prompt erlaubt genau das Set und bleibt frei von Klammerzeichen", () => {
  const prompt = konfiguration().agent.prompt.prompt;
  assert.ok(prompt.includes(TEMPLATE_REGEL));
  assert.ok(!/[[\]]/.test(prompt));
  assert.ok(!prompt.includes("Never write square brackets. Everything"));
});

test("Soft-Timeout-Anweisung verbietet weiter jede Klammer (Füllsätze bekommen keine Tags)", () => {
  const text = konfiguration().turn.soft_timeout_config.llm_generated_message_prompt_override;
  assert.ok(text.includes("Never write anything in square brackets"));
});

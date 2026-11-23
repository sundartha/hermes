import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LOCALES } from "../../src/i18n/locales.ts";

const VORLAGE = "../../elevenlabs/agent_configs/outbound-agent.template.json";
const TAGFAEHIGE_MODELLE = ["eleven_v3", "eleven_v3_conversational"];
const KLAMMER = /[[\]]/;

const konfiguration = () =>
  JSON.parse(readFileSync(new URL(VORLAGE, import.meta.url), "utf8")).agent.conversation_config;

const sprechRegeln = (sprache) => {
  const loc = LOCALES[sprache];
  return loc.prompt.speechRules({ loc, settings: { agentStyle: "neutral" } });
};

const KLAMMER_REGEL = {
  de: /Keine eckigen Klammern/,
  en: /No square brackets/,
  fr: /Aucun crochet/,
};
const TAG_ERLAUBNIS = /Selten darfst du|you may rarely|tu peux rarement|calm, thoughtful/;

for (const sprache of ["de", "en", "fr"]) {
  test(`speechRules ${sprache}: keine Klammerzeichen und keine Tag-Erlaubnis, Klammerverbot bleibt`, () => {
    const text = sprechRegeln(sprache);
    assert.ok(!KLAMMER.test(text));
    assert.ok(!TAG_ERLAUBNIS.test(text));
    assert.match(text, KLAMMER_REGEL[sprache]);
  });
}

test("Vorlage: ohne tagfähiges Modell keine Klammern und keine Tag-Ausnahme im Master-Prompt", () => {
  const konfig = konfiguration();
  assert.ok(!TAGFAEHIGE_MODELLE.includes(konfig.tts.model_id));
  const prompt = konfig.agent.prompt.prompt;
  assert.ok(!KLAMMER.test(prompt));
  assert.ok(!TAG_ERLAUBNIS.test(prompt));
  assert.match(prompt, /Never write square brackets/);
});

test("Vorlage: ohne tagfähiges Modell sind die vorgeschlagenen Audio-Tags leer", () => {
  assert.deepEqual(konfiguration().tts.suggested_audio_tags, []);
});

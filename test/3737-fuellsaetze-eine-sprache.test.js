import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const NEUTRALER_LAUT = /^(?:Hm+|Mh+m*)(?:\.\.\.)?$/;
const EINFACHE_WOERTER = /\b(?:the|there|right|still|almost|bit|more|that|Genau|noch|gleich|dabei|Voilà|encore|presque)\b/i;

const konfiguration = () =>
  JSON.parse(readFileSync(new URL(`../${TEMPLATE_REL}`, import.meta.url), "utf8")).agent.conversation_config;

const gesprocheneFesteTexte = () => {
  const config = konfiguration();
  const weiche = config.turn.soft_timeout_config;
  const presets = Object.values(config.language_presets).flatMap((preset) => {
    const uebersetzung = preset.soft_timeout_translation?.text;
    return uebersetzung ? [uebersetzung] : [];
  });
  return [weiche.message, ...weiche.additional_soft_timeout_messages, ...presets];
};

test("kein fester Fuellsatz der Vorlage steht in nur einer Sprache", () => {
  const texte = gesprocheneFesteTexte();
  assert.ok(texte.length >= 1);
  for (const text of texte) {
    assert.match(text, NEUTRALER_LAUT, `fester Text nicht sprachneutral: ${text}`);
    assert.ok(!EINFACHE_WOERTER.test(text), text);
  }
});

test("die Anweisung fuer erzeugte Fuellsaetze verlangt ausdruecklich die Sprache des Gespraechs", () => {
  const text = konfiguration().turn.soft_timeout_config.llm_generated_message_prompt_override;
  assert.ok(
    text.startsWith(
      "Generate a short, natural acknowledgement (max. 6-8 words) that you are working on the answer, " +
        "spoken in the language of the conversation: German in a German conversation, English in an English one, " +
        "French in a French one. ",
    ),
    text,
  );
  assert.ok(text.includes("Never write anything in square brackets"));
  assert.ok(!/[[\]]/.test(text));
});

test("die Vorlage haelt keine zusaetzlichen festen Fuellsaetze mehr", () => {
  assert.deepEqual(konfiguration().turn.soft_timeout_config.additional_soft_timeout_messages, []);
  assert.equal(konfiguration().turn.soft_timeout_config.message, "Hmm...");
});

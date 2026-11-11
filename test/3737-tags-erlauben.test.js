import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as audioTags from "../src/i18n/audio-tags.js";
import { LOCALES } from "../src/i18n/locales.js";

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

const SPEECH_TAGS = {
  de: `Keine eckigen Klammern und keine Regieanweisungen im Gesprochenen, mit einer Ausnahme: Selten darfst du genau ein Tag aus dieser festen Liste in eckigen Klammern direkt vor einen Satz setzen: ${LISTE}. Höchstens eines pro Antwort, im Zweifel keines. Jede andere Klammer wird dem Gegenüber vorgelesen und bleibt im Protokoll stehen. Stimmung trägst du sonst nur über die Wortwahl.`,
  en: `No square brackets and no stage directions in spoken text, with one exception: you may rarely put exactly one tag from this fixed list in square brackets directly before a sentence: ${LISTE}. At most one per answer, when in doubt none. Every other bracketed word is read out to the other person and stays in the record. Otherwise convey mood through word choice only.`,
  fr: `Aucun crochet ni indication de mise en scène dans le texte parlé, avec une exception : tu peux rarement placer exactement une balise de cette liste fixe entre crochets juste avant une phrase : ${LISTE}. Une seule au maximum par réponse, dans le doute aucune. Tout autre mot entre crochets est lu à voix haute à l'interlocuteur et reste dans le protocole. Sinon l'humeur passe uniquement par le choix des mots.`,
};

const vorlage = () => JSON.parse(readFileSync(new URL(`../${TEMPLATE_REL}`, import.meta.url), "utf8"));

test("Tag-Set: genau die sechs ruhigen Tags an einer Stelle", () => {
  assert.deepEqual([...(audioTags.AUDIO_TAGS ?? [])], ERWARTETES_SET);
  assert.ok(audioTags.AUDIO_TAGS.length <= MAX_TAGS);
  assert.ok(Object.isFrozen(audioTags.AUDIO_TAGS));
  assert.equal(audioTags.AUDIO_TAG_LISTE, LISTE);
});

test("Vorlage: suggested_audio_tags sind genau das Set, mit Beschreibung im Anbieter-Rahmen", () => {
  const tags = vorlage().agent.conversation_config.tts.suggested_audio_tags;
  assert.deepEqual(tags.map((eintrag) => eintrag.tag), ERWARTETES_SET);
  for (const eintrag of tags) {
    assert.deepEqual(Object.keys(eintrag).sort(), ["description", "tag"]);
    assert.ok(eintrag.tag.length <= MAX_TAG_ZEICHEN, eintrag.tag);
    assert.ok(eintrag.description.length > 0, eintrag.tag);
    assert.ok(eintrag.description.length <= MAX_BESCHREIBUNG_ZEICHEN, eintrag.tag);
  }
});

test("Vorlage: der Master-Prompt erlaubt genau das Set und bleibt frei von Klammerzeichen", () => {
  const prompt = vorlage().agent.conversation_config.agent.prompt.prompt;
  assert.ok(prompt.includes(TEMPLATE_REGEL));
  assert.ok(!/[[\]]/.test(prompt));
  assert.ok(!prompt.includes("Never write square brackets. Everything"));
});

for (const sprache of Object.keys(SPEECH_TAGS)) {
  test(`speechRules ${sprache}: erlaubt genau das Set, selten, höchstens eines, ohne Klammerzeichen`, () => {
    const regeln = LOCALES[sprache].prompt.speechRules({ loc: LOCALES[sprache], settings: {} });
    assert.ok(regeln.includes(SPEECH_TAGS[sprache]));
    assert.ok(!/[[\]]/.test(regeln));
  });
}

test("Soft-Timeout-Anweisung verbietet weiter jede Klammer (Füllsätze bekommen keine Tags)", () => {
  const text = vorlage().agent.conversation_config.turn.soft_timeout_config.llm_generated_message_prompt_override;
  assert.ok(text.includes("Never write anything in square brackets"));
});

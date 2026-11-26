import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { LOCALES } from "../../src/i18n/locales.ts";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const TEMPLATE = JSON.parse(readFileSync(new URL(`../../${TEMPLATE_REL}`, import.meta.url), "utf8"));
const CONVERSATION = TEMPLATE.agent.conversation_config;
const PRESETS = CONVERSATION.language_presets;
const PROMPT = CONVERSATION.agent.prompt.prompt;

const QUELLE = "https://elevenlabs.io/docs/overview/models (Eleven v4 Turbo, Supported languages), abgerufen 2026-11-26";
const SPRACHEN =
  "af am ar hy as ast az be bn bs bg my yue ca ceb hr cs da nl en et fil fi fr ff gl ka de el gu ha he hi hu is id it ja jv kam kn kk ko ky lo lv ln lt lg lb mk ms ml mt zh mi mr mn ne no oc or ps fa pl pt pa ro ru sr sn sd sk sl so ckb es sw sv tg ta te th tr uk ur uz vi cy wo zu".split(
    " ",
  );

const LOCALE_PRESETS = new Set(["de", "fr"]);

test("sprachwechsel-jede-sprache: die Quellenliste ist vollstaendig belegt", () => {
  assert.equal(SPRACHEN.length, 91, QUELLE);
  assert.equal(new Set(SPRACHEN).size, SPRACHEN.length);
});

test("sprachwechsel-jede-sprache: jede Sprache der Quelle ist Agentensprache oder Preset", () => {
  const zulaessig = new Set([CONVERSATION.agent.language, ...Object.keys(PRESETS)]);
  const fehlend = SPRACHEN.filter((code) => !zulaessig.has(code));
  assert.deepEqual(fehlend, [], `nicht zulaessig laut ${QUELLE}`);
  const ueberzaehlig = Object.keys(PRESETS).filter((code) => !SPRACHEN.includes(code));
  assert.deepEqual(ueberzaehlig, [], `Preset ausserhalb der Quellenliste ${QUELLE}`);
});

test("sprachwechsel-jede-sprache: die Agentensprache bekommt kein eigenes Preset", () => {
  assert.equal(CONVERSATION.agent.language, "en");
  assert.equal(PRESETS.en, undefined);
});

test("sprachwechsel-jede-sprache: Presets ohne kuratierten Offenlegungssatz tragen first_message null", () => {
  for (const [code, preset] of Object.entries(PRESETS)) {
    if (LOCALE_PRESETS.has(code)) {
      assert.ok(LOCALES[code], code);
      assert.equal(preset.overrides.agent.first_message, "{{eroeffnung}}", code);
      continue;
    }
    assert.equal(LOCALES[code], undefined, `${code} hat einen Locale-Eintrag, braucht also ein eigenes Preset`);
    assert.deepEqual(preset, { overrides: { agent: { first_message: null } } }, code);
  }
});

test("sprachwechsel-jede-sprache: keine Nutzer-Sprachauswahl, die Startsprache kommt aus dem Anruf", () => {
  const roh = JSON.stringify(CONVERSATION, (key, wert) => (key.startsWith("_") ? undefined : wert));
  assert.ok(!roh.includes("{{language}}"));
  assert.ok(!/tenant[_.]?language|user[_.]?language|default[_.]?language/i.test(roh));
  const override = TEMPLATE.platform_settings.overrides.conversation_config_override;
  assert.equal(override.agent.language, true);
});

test("sprachwechsel-jede-sprache: der Prompt behauptet keine begrenzte Sprachmenge und sagt, dass jede Sprache geht", () => {
  assert.match(PROMPT, /You can hold the conversation in any language the other party speaks/);
  assert.match(PROMPT, /never tell anyone that you cannot speak their language or that your languages are limited/);
  assert.ok(!/\b(only|just|exclusively|solely)\b[^.]*\b(German|English|French|Spanish)\b[^.]*\b(German|English|French|Spanish)\b/i.test(PROMPT));
  assert.ok(!/cannot speak[^.]*language/i.test(PROMPT.replace(/never tell anyone that you cannot speak their language/, "")));
});

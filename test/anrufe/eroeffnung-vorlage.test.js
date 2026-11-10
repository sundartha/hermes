import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runOutbound } from "../_outbound-harness.js";

const VORLAGE_PFAD = "elevenlabs/agent_configs/outbound-agent.template.json";
const VORLAGE = JSON.parse(readFileSync(VORLAGE_PFAD, "utf8"));
const KONFIG = VORLAGE.agent.conversation_config;
const EROEFFNUNG_PLATZHALTER = "{{eroeffnung}}";
const ALTE_SATZANFAENGE = ["Ich bin der KI-Assistent von", "I am the AI assistant of", "Je suis l'assistant IA de"];

test("Vorlage: first_message und jedes Sprach-Preset mit erstem Satz tragen nur die Variable eroeffnung", () => {
  assert.equal(KONFIG.agent.first_message, EROEFFNUNG_PLATZHALTER);
  const presetSaetze = Object.entries(KONFIG.language_presets).map(([sprache, preset]) => [
    sprache,
    preset?.overrides?.agent?.first_message ?? null,
  ]);
  assert.deepEqual(
    presetSaetze.filter(([, satz]) => satz !== null),
    [
      ["de", EROEFFNUNG_PLATZHALTER],
      ["fr", EROEFFNUNG_PLATZHALTER],
    ],
  );
});

test("Vorlage: kein ausgeschriebener Eroeffnungssatz mehr, weder im Text noch in den Hinweisen", () => {
  const text = readFileSync(VORLAGE_PFAD, "utf8");
  for (const anfang of ALTE_SATZANFAENGE) assert.equal(text.includes(anfang), false, anfang);
  assert.equal(text.includes("{{opening_line}} I am"), false);
});

const ERSTER_SATZ = Object.freeze({
  de: "ich bin Hermes, der KI-Assistent von Jonas Beispiel, und ich fasse das Gespräch für Jonas zusammen.",
  en: "I am Hermes, the AI assistant of Jonas Beispiel, and I will summarise this conversation for Jonas.",
  fr: "je suis Hermes, l'assistant IA de Jonas Beispiel, et je résume cette conversation pour Jonas.",
});

for (const [sprache, erwartet] of Object.entries(ERSTER_SATZ)) {
  test(`/voice/outbound ${sprache}: der erste Redebeitrag geht mit Gedankenstrich in den KI-Hinweis mit Hermes und Vornamen ueber`, async () => {
    const { body } = await runOutbound({ call: { language: sprache, goal: "" } });
    const sprechtext = /<Say[^>]*>([\s\S]*?)<\/Say>/.exec(body)[1].replaceAll("&apos;", "'");
    assert.ok(sprechtext.endsWith(` – ${erwartet}`), sprechtext);
  });
}

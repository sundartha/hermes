import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

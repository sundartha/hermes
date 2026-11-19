import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const VORLAGE = new URL("../../elevenlabs/agent_configs/outbound-agent.template.json", import.meta.url);
const konfiguration = JSON.parse(readFileSync(VORLAGE, "utf8")).agent.conversation_config;
const vorlagenPrompt = konfiguration.agent.prompt.prompt;

test("5505 Vorlage: der Prompt verbietet die Frage nach Anwesenheit und Hoerbarkeit", () => {
  assert.match(vorlagenPrompt, /Never ask whether the other person is still there or can hear you/);
});

test("5505 Vorlage: nach der Eroeffnung Schweigen bis zur ersten Aeusserung, auch bei 8 Sekunden Stille", () => {
  assert.match(
    vorlagenPrompt,
    /after your opening stay silent until the other person speaks for the first time, even if it stays quiet for 8 seconds or more/,
  );
});

test("5505 Vorlage: keine feste deutsche Formulierung der Frage im Prompt", () => {
  assert.doesNotMatch(vorlagenPrompt, /ich kann (?:dich|Sie) (?:leider )?nicht hören/i);
  assert.doesNotMatch(vorlagenPrompt, /sind Sie noch da|bist du noch da/i);
});

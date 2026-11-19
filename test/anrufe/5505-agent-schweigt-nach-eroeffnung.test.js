import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const VORLAGE = new URL("../../elevenlabs/agent_configs/outbound-agent.template.json", import.meta.url);
const konfiguration = JSON.parse(readFileSync(VORLAGE, "utf8")).agent.conversation_config;
const vorlagenPrompt = konfiguration.agent.prompt.prompt;
const FESTE_FRAGE =
  /sind sie noch da|bist du noch da|können sie mich hören|kannst du mich hören|are you still there|can you hear me|êtes-vous encore là|vous m'entendez/i;

test("5505-K1 Vorlage: der Prompt verbietet die Frage, ob die Gegenseite noch da ist oder hören kann, bis sie selbst gesprochen hat", () => {
  assert.match(
    vorlagenPrompt,
    /Never ask whether the other person is still there or can hear you; after your opening/,
  );
});

test("5505-K2 Vorlage: nach der Eröffnung Schweigen bis zur ersten Äußerung, auch bei mindestens 8 Sekunden Stille", () => {
  assert.match(
    vorlagenPrompt,
    /after your opening stay silent until the other person speaks for the first time, even if it stays quiet for 8 seconds or more\./,
  );
});

test("5505-K3 Vorlage: die Regel nennt keine feste Frageformulierung in irgendeiner Sprache", () => {
  assert.doesNotMatch(vorlagenPrompt, FESTE_FRAGE);
});

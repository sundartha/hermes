import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const VORLAGE = JSON.parse(readFileSync("elevenlabs/agent_configs/outbound-agent.template.json", "utf8"));
const KONFIG = VORLAGE.agent.conversation_config;
const PROMPT = KONFIG.agent.prompt.prompt;
const TEILE = PROMPT.split("HOW YOU SPEAK:\n");
const ABSCHNITT = TEILE[1].split("\n")[0];

test("Eroeffnungs-Regel verbietet nur die unaufgeforderte Wiederholung", () => {
  assert.match(ABSCHNITT, /unprompted|unasked|unless asked/i);
  assert.doesNotMatch(ABSCHNITT, /never repeat or rephrase any of it\./);
});

test("Eroeffnungs-Regel laesst auf Nachfrage die KI-Angabe zu", () => {
  assert.match(ABSCHNITT, /asked[^.]*AI|AI[^.]*asked/i);
});

test("Eroeffnungs-Regel gibt dem Rueckfall aus callee_relation Vorrang", () => {
  assert.match(ABSCHNITT, /callee_relation/);
  assert.match(ABSCHNITT, /precedence|priority/i);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";

const VORLAGE_NATUERLICH =
  'Sound like a person on the phone, not like text being read out: everyday speech instead of written language, no filler phrases like "Happy to help you with that". Acknowledge briefly, for example "Ah, okay" or "I see", respond to what was said first, then ask on. Stay calm and matter-of-fact but friendly: no enthusiasm, no exclamations, no gushing confirmations like "Great" or "Wonderful". Show feeling only when the other person sets that tone.';

const masterPrompt = () => {
  const vorlage = JSON.parse(readFileSync(new URL(`../../${TEMPLATE_REL}`, import.meta.url), "utf8"));
  const { agent } = vorlage.agent.conversation_config;
  return agent.prompt.prompt;
};
const abschnitt = (prompt, titel) => {
  const start = prompt.indexOf(`${titel}:\n`);
  const ende = prompt.indexOf("\n\n", start);
  return prompt.slice(start, ende);
};

test("Master-Prompt der Vorlage traegt dieselben Regeln in HOW YOU SPEAK", () => {
  const sprechen = abschnitt(masterPrompt(), "HOW YOU SPEAK");
  assert.ok(sprechen.includes(VORLAGE_NATUERLICH));
  assert.ok(sprechen.includes("Keep your replies short (one to two sentences), at most one question per turn."));
});

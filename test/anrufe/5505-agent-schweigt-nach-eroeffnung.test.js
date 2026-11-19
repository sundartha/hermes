import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

const VORLAGE = new URL("../../elevenlabs/agent_configs/outbound-agent.template.json", import.meta.url);
const vorlagenPrompt = JSON.parse(readFileSync(VORLAGE, "utf8")).agent.conversation_config.agent.prompt.prompt;

const REGEL = {
  de: /^- Frage nie, ob dein Gegenüber noch da ist oder dich hören kann; nach deiner Eröffnung schweigst du, bis dein Gegenüber zum ersten Mal spricht, auch wenn es mindestens 8 Sekunden still bleibt\.$/m,
  en: /^- Never ask whether the other person is still there or can hear you; after your opening stay silent until the other person speaks for the first time, even if it stays quiet for 8 seconds or more\.$/m,
  fr: /^- Ne demande jamais si ton interlocuteur est encore là ou s'il t'entend ; après ton ouverture, tais-toi jusqu'à ce que ton interlocuteur parle pour la première fois, même si le silence dure au moins 8 secondes\.$/m,
};
const FESTE_FRAGE = /sind sie noch da|bist du noch da|können sie mich hören|kannst du mich hören|are you still there|can you hear me|êtes-vous encore là|vous m'entendez/i;

let systemPrompt;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({ calls: [], tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }] }),
  );
  await import("../../src/config.js");
  ({ systemPrompt } = await import("../../src/claude.js"));
});

const promptFor = (language, direction) =>
  systemPrompt(seedCall({ tenantId: BOOTSTRAP_TENANT_ID, language, direction }));

test("5505-K1 Vorlage: der Prompt verbietet die Frage, ob die Gegenseite noch da ist oder hören kann, bis sie selbst gesprochen hat", () => {
  assert.match(vorlagenPrompt, /Never ask whether the other person is still there or can hear you/);
});

test("5505-K2 Vorlage: nach der Eröffnung Schweigen bis zur ersten Äußerung, auch bei mindestens 8 Sekunden Stille", () => {
  assert.match(
    vorlagenPrompt,
    /after your opening stay silent until the other person speaks for the first time, even if it stays quiet for 8 seconds or more/,
  );
});

test("5505-K1 Vorlage: keine feste Frageformulierung in irgendeiner Sprache", () => {
  assert.doesNotMatch(vorlagenPrompt, FESTE_FRAGE);
});

for (const direction of ["inbound", "outbound"]) {
  for (const language of ["de", "en", "fr"]) {
    test(`5505-K3 speechRules ${language}/${direction}: Regel steht genau einmal, ohne feste Frage`, () => {
      const prompt = promptFor(language, direction);
      assert.equal(prompt.match(new RegExp(REGEL[language].source, "gm"))?.length, 1);
      assert.doesNotMatch(prompt, FESTE_FRAGE);
    });
  }
}

test("5505-K3 speechRules de: die Regel bleibt in der Du-Form ohne Sie", () => {
  const zeile = promptFor("de", "outbound").match(REGEL.de)[0];
  assert.doesNotMatch(zeile, /\bSie\b|\bIhnen?\b|\bIhr\b/);
});

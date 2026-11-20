import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const KARTE = JSON.parse(readFileSync("elevenlabs/test_configs/a6-offenlegung-erster-satz.json", "utf8"));
const VORLAGE = JSON.parse(readFileSync("elevenlabs/agent_configs/outbound-agent.template.json", "utf8"));
const EROEFFNUNG_PLATZHALTER = "{{eroeffnung}}";

test("A6-Karte: Erfolgsbeispiel ist die Vorlage-first_message mit eingesetzter Variable", () => {
  const ersteNachricht = VORLAGE.agent.conversation_config.agent.first_message;
  const vorlage = ersteNachricht.replace(EROEFFNUNG_PLATZHALTER, KARTE.dynamic_variables.eroeffnung);
  assert.equal(KARTE.success_examples[0].response, vorlage);
});

test("A6-Karte: Erfolgsbeispiele und Fehlschlaege widersprechen sich nicht", () => {
  const erfolge = new Set(KARTE.success_examples.map((beispiel) => beispiel.response));
  assert.equal(KARTE.failure_examples.filter((beispiel) => erfolge.has(beispiel.response)).length, 0);
});

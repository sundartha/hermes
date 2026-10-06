import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeCall } from "../src/claude.js";
import {
  baseStartParams,
  checkConversationDriverContract,
  makeCallbackSpy,
  MOCK_OBJECTIVE,
  waitUntil,
} from "./conversation-driver-contract.js";
import { makeMockConversationDriver } from "./fixtures/mock-conversation-driver.js";

checkConversationDriverContract(makeMockConversationDriver);

test("Vertrag: die Anbieter-Zusammenfassung aus onOutcomeDelivered ersetzt unsere eigene summarizeCall nicht", async () => {
  assert.equal(typeof summarizeCall, "function", "summarizeCall bleibt bestehen und aufrufbar");

  const callId = "cdc-summary-pin";
  const spy = makeCallbackSpy();
  const driver = makeMockConversationDriver({ callbacks: spy.callbacks });
  await driver.startConversation(baseStartParams(callId, MOCK_OBJECTIVE.OUTCOME));
  await waitUntil(() => spy.outcomes.length > 0);

  const outcome = spy.outcomes[0];
  assert.equal(typeof outcome.summary, "string", "die Anbieter-Zusammenfassung ist reiner Text");
  assert.notEqual(
    outcome.summary,
    summarizeCall,
    "Text und Funktion sind zwei getrennte Werte - der Port liefert niemals unsere Funktion zurueck",
  );
});

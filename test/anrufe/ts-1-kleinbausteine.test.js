import assert from "node:assert/strict";
import { test } from "node:test";

import { providerTurnMessage, toolResultsMessage } from "../../src/llm/messages.ts";

test("ts-1-kleinbausteine: Nachrichten tragen ihre Rolle", () => {
  assert.deepEqual(providerTurnMessage({ a: 1 }), { role: "assistant", providerTurn: { a: 1 } });
  assert.deepEqual(toolResultsMessage([1]), { role: "toolResults", results: [1] });
});

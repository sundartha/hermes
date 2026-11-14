import assert from "node:assert/strict";
import { test } from "node:test";

import { elSipUri, elSipZiel } from "../../src/elevenlabs/inbound-sip-uri.ts";
import { providerTurnMessage, toolResultsMessage } from "../../src/llm/messages.ts";

test("ts-1-kleinbausteine: Nicht-Text als Nummer wird abgelehnt, auch wenn er wie E.164 aussieht", () => {
  const wieNummer = { toString: () => "+4915112345678" };
  assert.throws(() => elSipUri({ did: wieNummer, token: "t" }), /DID ist keine E\.164-Nummer/);
  assert.throws(() => elSipZiel(wieNummer), /Absender ist keine E\.164-Nummer/);
  assert.equal(elSipZiel("+4915112345678"), "sip:+4915112345678@sip.rtc.elevenlabs.io");
});

test("ts-1-kleinbausteine: Nachrichten tragen ihre Rolle", () => {
  assert.deepEqual(providerTurnMessage({ a: 1 }), { role: "assistant", providerTurn: { a: 1 } });
  assert.deepEqual(toolResultsMessage([1]), { role: "toolResults", results: [1] });
});

import assert from "node:assert/strict";
import { test } from "node:test";

const NICHT_GEFUNDEN = { code: "ERR_MODULE_NOT_FOUND" };

test("H4c-3: src/no-speech-escalation.ts ist mit dem alten Gespraechsweg entfallen", async () => {
  await assert.rejects(import("../../src/no-speech-escalation.ts"), NICHT_GEFUNDEN);
});

test("H4c-3: src/llm-billing-outage.ts ist mit dem alten Gespraechsweg entfallen", async () => {
  await assert.rejects(import("../../src/llm-billing-outage.ts"), NICHT_GEFUNDEN);
});

test("H4c-3: src/telephony/leg-turn-loop.ts ist mit dem alten Gespraechsweg entfallen", async () => {
  await assert.rejects(import("../../src/telephony/leg-turn-loop.ts"), NICHT_GEFUNDEN);
});

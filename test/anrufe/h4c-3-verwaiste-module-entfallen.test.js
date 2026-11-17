import assert from "node:assert/strict";
import { test } from "node:test";

const ENTFALLENE_MODULE = [
  "../../src/no-speech-escalation.ts",
  "../../src/llm-billing-outage.ts",
  "../../src/telephony/leg-turn-loop.ts",
];

for (const pfad of ENTFALLENE_MODULE) {
  test(`H4c-3: ${pfad.slice("../../".length)} ist mit dem alten Gespraechsweg entfallen`, async () => {
    await assert.rejects(import(pfad), { code: "ERR_MODULE_NOT_FOUND" });
  });
}

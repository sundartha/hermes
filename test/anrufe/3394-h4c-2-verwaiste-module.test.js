import assert from "node:assert/strict";
import { test } from "node:test";

const VERWAISTE_MODULE = [
  "../../src/speech-chunker.ts",
  "../../src/thinking-signal.ts",
  "../../src/tool-follow-up.ts",
  "../../src/speech-shape.ts",
];

const ERWARTETE_EXPORTE = [
  "PROVIDER_WEBHOOK_HARDCUT_MS",
  "TURN_NETWORK_RESERVE_MS",
  "llmTurnBudgetMs",
  "turnBudgetMs",
  "turnBudgetOverrun",
];

for (const modul of VERWAISTE_MODULE) {
  test(`H4c-2: ${modul.split("/").pop()} des alten Gespraechswegs ist entfallen`, async () => {
    await assert.rejects(import(modul), { code: "ERR_MODULE_NOT_FOUND" });
  });
}

test("H4c-2: turn-budget behaelt nur Webhook-Frist und Zugbudget, die Werkzeugrunden-Schleife des alten Wegs ist entfallen", async () => {
  const exporte = await import("../../src/turn-budget.ts");
  assert.deepEqual(Object.keys(exporte).sort(), [...ERWARTETE_EXPORTE].sort());
});

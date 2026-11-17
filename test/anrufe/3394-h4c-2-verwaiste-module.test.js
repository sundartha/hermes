import assert from "node:assert/strict";
import { test } from "node:test";

const ERWARTETE_EXPORTE = [
  "PROVIDER_WEBHOOK_HARDCUT_MS",
  "TURN_NETWORK_RESERVE_MS",
  "llmTurnBudgetMs",
  "turnBudgetMs",
  "turnBudgetOverrun",
];

const FEHLT = { code: "ERR_MODULE_NOT_FOUND" };

test("H4c-2: speech-chunker.ts des alten Gespraechswegs ist entfallen", async () => {
  await assert.rejects(import("../../src/speech-chunker.ts"), FEHLT);
});

test("H4c-2: thinking-signal.ts des alten Gespraechswegs ist entfallen", async () => {
  await assert.rejects(import("../../src/thinking-signal.ts"), FEHLT);
});

test("H4c-2: tool-follow-up.ts des alten Gespraechswegs ist entfallen", async () => {
  await assert.rejects(import("../../src/tool-follow-up.ts"), FEHLT);
});

test("H4c-2: speech-shape.ts des alten Gespraechswegs ist entfallen", async () => {
  await assert.rejects(import("../../src/speech-shape.ts"), FEHLT);
});

test("H4c-2: turn-budget behaelt nur Webhook-Frist und Zugbudget, die Werkzeugrunden-Schleife des alten Wegs ist entfallen", async () => {
  const exporte = await import("../../src/turn-budget.ts");
  assert.deepEqual(Object.keys(exporte).sort(), [...ERWARTETE_EXPORTE].sort());
});

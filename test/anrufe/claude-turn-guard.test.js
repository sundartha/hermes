import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";

let claudeExports;

before(async () => {
  process.env.MAX_EMPTY_TURNS = "2";
  process.env.CALLER_SUBSTANCE_MIN_LEN = "2";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
      calls: [],
    }),
  );
  await import("../../src/config.ts");
  claudeExports = await import("../../src/claude.js");
});

test("H4c-1a: claude.js bietet keinen Gespraechsrunden-Eingang agentTurn mehr", () => {
  assert.equal(claudeExports.agentTurn, undefined);
  assert.equal(typeof claudeExports.summarizeCall, "function");
  assert.equal(typeof claudeExports.systemPrompt, "function");
});

test("H4c-1b: claude.js exportiert nur noch Prompt, Werkzeugliste, Zusammenfassung und die zwei Hilfen mit Importeur", () => {
  assert.deepEqual(Object.keys(claudeExports).sort(), [
    "agentToolNames",
    "agentTools",
    "disclosureSentence",
    "isSideEffectOnlyTool",
    "isSubstantialCallerText",
    "summarizeCall",
    "systemPrompt",
    "toolDefs",
  ]);
});

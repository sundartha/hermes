import assert from "node:assert/strict";
import { test } from "node:test";
import { tempDataDir, seedState } from "../helpers.js";

test("H4c-1a: claude.js bietet keinen Gespraechsrunden-Eingang agentTurn mehr", async () => {
  process.env.DATA_DIR = tempDataDir(seedState({ tenants: [], calls: [] }));
  const claude = await import("../../src/claude.js");
  assert.equal(claude.agentTurn, undefined);
  assert.equal(typeof claude.summarizeCall, "function");
  assert.equal(typeof claude.systemPrompt, "function");
});

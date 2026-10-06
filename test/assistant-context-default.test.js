import { test, before } from "node:test";
import assert from "node:assert/strict";

let config;
before(async () => {
  delete process.env.ASSISTANT_CONTEXT_ENABLED;
  ({ config } = await import("../src/config.js"));
});

test("I12: assistantContextEnabled ohne Env-Var -> true (Produkt-Default an)", () => {
  assert.equal(config.tenancy.assistantContextEnabled, true);
});

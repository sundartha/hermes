import assert from "node:assert/strict";
import { test } from "node:test";

import { createLlmProvider } from "../../src/llm/registry.js";

function providerReturning() {
  const seen = [];
  const provider = createLlmProvider({
    messagesCreate: (params) => {
      seen.push(params);
      return Promise.resolve({ content: [] });
    },
  });
  return { provider, seen };
}

test("Anthropic-Adapter: cachePrefix ohne Systemtext wirft lokal statt einen Textblock ohne Text zu senden", async () => {
  const { provider, seen } = providerReturning();
  await assert.rejects(
    provider.complete({ model: "m", system: undefined, cachePrefix: true, messages: [] }),
    { name: "TypeError", message: "Anthropic-Adapter: system fehlt bei cachePrefix" },
  );
  assert.equal(seen.length, 0);
});

test("Anthropic-Adapter: ohne cachePrefix bleibt ein ausdrücklich leeres system ein durchgereichter Schlüssel", async () => {
  const { provider, seen } = providerReturning();
  await provider.complete({ model: "m", system: undefined, messages: [] });
  assert.deepEqual(Object.keys(seen[0]), ["model", "system", "messages"]);
  assert.equal(seen[0].system, undefined);
});

test("Anthropic-Adapter: cachePrefix mit Systemtext sendet den Text als Block mit Cache-Marke", async () => {
  const { provider, seen } = providerReturning();
  await provider.complete({ model: "m", system: "Systemtext", cachePrefix: true, messages: [] });
  assert.deepEqual(seen[0].system, [
    { type: "text", text: "Systemtext", cache_control: { type: "ephemeral" } },
  ]);
});

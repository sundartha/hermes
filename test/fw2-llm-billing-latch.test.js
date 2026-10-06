import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { activeLlmErrors, createLlmProvider } from "../src/llm/registry.js";
import { anthropicErrors } from "../src/llm/adapters/anthropic.js";
import { deepseekErrors } from "../src/llm/adapters/deepseek.js";
import { usableFallbackProvider } from "../src/llm/provider.js";
import { markBillingBlocked } from "../src/llm/billing-latch.js";
import { llmFallbackFindings, LLM_FALLBACK_FINDING } from "../src/boot-guard.js";
import { makeConfigOverrides } from "./helpers.js";
import { readFileSync } from "node:fs";

const { withConfigOverrides } = makeConfigOverrides(config);

const TEST_DEEPSEEK_KEY = "sk-fw2-latch-dummy";
const LATCH_COOLDOWN_MS = 60000;

function anthropicOk() {
  return Promise.resolve({
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

function deepseekOk() {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
    text: async () => "",
  });
}

function expireLatch(provider) {
  markBillingBlocked({ provider, nowMs: Date.now(), cooldownMs: 0 });
}

test("FW2-R1: kein Fallback konfiguriert - der Latch bleibt wirkungslos (Byte-Identitaets-Invariante)", async () => {
  try {
    let anthropicCalls = 0;
    let deepseekCalls = 0;
    markBillingBlocked({ provider: "anthropic", nowMs: Date.now(), cooldownMs: 60000 });
    const provider = createLlmProvider({
      messagesCreate: (...args) => {
        anthropicCalls++;
        return anthropicOk(...args);
      },
      chatCompletionsFetch: (...args) => {
        deepseekCalls++;
        return deepseekOk(...args);
      },
    });
    assert.equal(provider.errors, anthropicErrors);
    const turn = await provider.complete({ model: "claude-haiku-4-5", system: "S", messages: [] });
    assert.equal(turn.text, "ok");
    assert.equal(anthropicCalls, 1);
    assert.equal(deepseekCalls, 0, "ohne Fallback darf der Latch nichts umleiten");
  } finally {
    expireLatch("anthropic");
  }
});

test("FW2-R2: Fallback konfiguriert, Latch NICHT gesetzt - der Primaeranbieter faehrt die Anfrage", async () => {
  await withConfigOverrides(
    { llmProviderFallback: "deepseek", deepseekApiKey: TEST_DEEPSEEK_KEY },
    async () => {
      let anthropicCalls = 0;
      let deepseekCalls = 0;
      const provider = createLlmProvider({
        messagesCreate: () => {
          anthropicCalls++;
          return anthropicOk();
        },
        chatCompletionsFetch: () => {
          deepseekCalls++;
          return deepseekOk();
        },
      });
      const turn = await provider.complete({ model: "claude-haiku-4-5", system: "S", messages: [] });
      assert.equal(turn.text, "ok");
      assert.equal(anthropicCalls, 1);
      assert.equal(deepseekCalls, 0);
    },
  );
});

test("FW2-R3: Fallback konfiguriert, Latch gesetzt - GENAU EINMAL der Ausweich-Anbieter, nie beide", async () => {
  await withConfigOverrides(
    { llmProviderFallback: "deepseek", deepseekApiKey: TEST_DEEPSEEK_KEY },
    async () => {
      try {
        let anthropicCalls = 0;
        let deepseekCalls = 0;
        const provider = createLlmProvider({
          messagesCreate: () => {
            anthropicCalls++;
            return anthropicOk();
          },
          chatCompletionsFetch: () => {
            deepseekCalls++;
            return deepseekOk();
          },
        });
        markBillingBlocked({ provider: "anthropic", nowMs: Date.now(), cooldownMs: 60000 });
        const turn = await provider.complete({ model: "deepseek-v4-pro", system: "S", messages: [] });
        assert.equal(turn.text, "ok");
        assert.equal(deepseekCalls, 1, "der Ausweich-Anbieter faehrt die Anfrage genau einmal");
        assert.equal(anthropicCalls, 0, "der geblockte Anbieter wird NICHT zusaetzlich angefragt");
      } finally {
        expireLatch("anthropic");
      }
    },
  );
});

test("FW2-R4: Latch abgelaufen (Cooldown ueberschritten) - das Routing faellt auf den Primaeranbieter zurueck", async () => {
  await withConfigOverrides(
    { llmProviderFallback: "deepseek", deepseekApiKey: TEST_DEEPSEEK_KEY },
    async () => {
      const nowMs = Date.now();
      markBillingBlocked({
        provider: "anthropic",
        nowMs: nowMs - LATCH_COOLDOWN_MS - 1,
        cooldownMs: LATCH_COOLDOWN_MS,
      });
      let anthropicCalls = 0;
      let deepseekCalls = 0;
      const provider = createLlmProvider({
        messagesCreate: () => {
          anthropicCalls++;
          return anthropicOk();
        },
        chatCompletionsFetch: () => {
          deepseekCalls++;
          return deepseekOk();
        },
      });
      const turn = await provider.complete({ model: "claude-haiku-4-5", system: "S", messages: [] });
      assert.equal(turn.text, "ok");
      assert.equal(anthropicCalls, 1);
      assert.equal(deepseekCalls, 0);
    },
  );
});

test("FW2-R5: activeLlmErrors() folgt dem Latch-Zustand - anthropic vor, deepseek nach dem Setzen", async () => {
  await withConfigOverrides(
    { llmProviderFallback: "deepseek", deepseekApiKey: TEST_DEEPSEEK_KEY },
    async () => {
      try {
        assert.equal(activeLlmErrors(), anthropicErrors);
        markBillingBlocked({ provider: "anthropic", nowMs: Date.now(), cooldownMs: 60000 });
        assert.equal(activeLlmErrors(), deepseekErrors);
      } finally {
        expireLatch("anthropic");
      }
    },
  );
});

test("FW2-R6: usableFallbackProvider - leer bei ungesetzt/identisch, sonst der Wert", () => {
  assert.equal(usableFallbackProvider({ provider: "anthropic", fallback: "" }), "");
  assert.equal(usableFallbackProvider({ provider: "anthropic", fallback: "anthropic" }), "");
  assert.equal(usableFallbackProvider({ provider: "anthropic", fallback: "deepseek" }), "deepseek");
});

test("FW2-R7: llmFallbackFindings - leer bei ungesetzt/verschieden, genau EIN nicht-fataler Befund bei Gleichheit", () => {
  assert.deepEqual(llmFallbackFindings({ provider: "anthropic", fallback: "" }), []);
  assert.deepEqual(llmFallbackFindings({ provider: "anthropic", fallback: "deepseek" }), []);
  const findings = llmFallbackFindings({ provider: "anthropic", fallback: "anthropic" });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, false);
  assert.equal(findings[0].code, LLM_FALLBACK_FINDING.SAME_AS_PRIMARY);
});

test("FW2-R8: render.yaml dokumentiert LLM_PROVIDER_FALLBACK und LLM_BILLING_LATCH_COOLDOWN_MS", () => {
  const renderYaml = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
  assert.match(renderYaml, /key: LLM_PROVIDER_FALLBACK/);
  assert.match(renderYaml, /key: LLM_BILLING_LATCH_COOLDOWN_MS\s*\n\s*value: "900000"/);
});

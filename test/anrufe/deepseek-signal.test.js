import assert from "node:assert/strict";
import { test } from "node:test";

import { config } from "../../src/config.js";
import { createLlmProvider } from "../../src/llm/registry.js";
import { LLM_PROVIDER } from "../../src/llm/provider.ts";
import { makeConfigOverrides } from "../helpers.js";
import { DEEPSEEK_SCHLUESSEL_BEISPIEL } from "../gemeinsam/erfundene-geheimnisse.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const MODEL = "deepseek-v4-pro";
const MESSAGES = [{ role: "user", content: "x" }];

const answer = (json) => ({ ok: true, status: 200, json: async () => json, text: async () => "" });
const plainAnswer = () => answer({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });

async function mitDeepseek(response, options, pruefung) {
  const inits = [];
  await withConfigOverrides(
    { llmProvider: LLM_PROVIDER.DEEPSEEK, deepseekApiKey: DEEPSEEK_SCHLUESSEL_BEISPIEL },
    async () => {
      const provider = createLlmProvider({
        ...options,
        chatCompletionsFetch: (url, init) => {
          inits.push(init);
          return Promise.resolve(response);
        },
      });
      await pruefung(provider, inits);
    },
  );
}

test("deepseek-signal: ohne Aufrufer-Signal und ohne Frist geht kein Signal mit", async () => {
  await mitDeepseek(plainAnswer(), {}, async (provider, inits) => {
    await provider.complete({ model: MODEL, messages: MESSAGES });
    assert.equal(inits[0].signal, undefined);
  });
});

test("deepseek-signal: nur ein Aufrufer-Signal geht unveraendert mit", async () => {
  const controller = new AbortController();
  await mitDeepseek(plainAnswer(), {}, async (provider, inits) => {
    await provider.complete({ model: MODEL, messages: MESSAGES, signal: controller.signal });
    assert.equal(inits[0].signal, controller.signal);
  });
});

test("deepseek-signal: positive Frist gibt ein noch nicht abgelaufenes Signal mit", async () => {
  await mitDeepseek(plainAnswer(), { requestTimeoutMs: 60_000 }, async (provider, inits) => {
    await provider.complete({ model: MODEL, messages: MESSAGES });
    assert.ok(inits[0].signal instanceof AbortSignal);
    assert.equal(inits[0].signal.aborted, false);
  });
});

test("deepseek-signal: Aufrufer-Signal und Frist zusammen brechen mit dem Aufrufer ab", async () => {
  const controller = new AbortController();
  await mitDeepseek(plainAnswer(), { requestTimeoutMs: 60_000 }, async (provider, inits) => {
    await provider.complete({ model: MODEL, messages: MESSAGES, signal: controller.signal });
    assert.notEqual(inits[0].signal, controller.signal);
    assert.equal(inits[0].signal.aborted, false);
    controller.abort();
    assert.equal(inits[0].signal.aborted, true);
  });
});

for (const frist of [0, -5, Number.NaN, "60000"]) {
  test(`deepseek-signal: Frist ${String(frist)} gibt kein Signal mit`, async () => {
    await mitDeepseek(plainAnswer(), { requestTimeoutMs: frist }, async (provider, inits) => {
      await provider.complete({ model: MODEL, messages: MESSAGES });
      assert.equal(inits[0].signal, undefined);
    });
  });
}

test("deepseek-signal: Antwort ohne Nachricht liefert leeren Text und keine Werkzeugaufrufe", async () => {
  await mitDeepseek(answer({ choices: [{ finish_reason: "stop" }] }), {}, async (provider) => {
    const turn = await provider.complete({ model: MODEL, messages: MESSAGES });
    assert.equal(turn.text, "");
    assert.deepEqual(turn.toolCalls, []);
    assert.equal(turn.stopReason, "stop");
  });
});

test("deepseek-signal: Werkzeugaufruf ohne function-Angabe scheitert mit der Meldung ohne Namen", async () => {
  const json = { choices: [{ message: { content: "", tool_calls: [{ id: "call_1" }] }, finish_reason: "tool_calls" }] };
  await mitDeepseek(answer(json), {}, async (provider) => {
    await assert.rejects(provider.complete({ model: MODEL, messages: MESSAGES }), {
      message: "DeepSeek-Adapter: Werkzeugaufruf ohne Namen (Aufruf call_1)",
    });
  });
});

const ZAHL_ALS_TEXT = [
  {
    name: "prompt_tokens als Text",
    usage: { prompt_tokens: "10", prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6, completion_tokens: 2 },
    expected: { inputUncachedTokens: 10, inputCacheReadTokens: 0, outputTokens: 2, estimated: true },
  },
  {
    name: "completion_tokens als Text",
    usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6, completion_tokens: "2" },
    expected: { inputUncachedTokens: 10, inputCacheReadTokens: 0, outputTokens: 0, estimated: true },
  },
];

for (const { name, usage, expected } of ZAHL_ALS_TEXT) {
  test(`deepseek-signal: Verbrauch mit ${name} gilt als nicht gemeldet`, async () => {
    const json = { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage };
    await mitDeepseek(answer(json), {}, async (provider) => {
      const turn = await provider.complete({ model: MODEL, messages: MESSAGES });
      assert.deepEqual(turn.usage, { inputCacheWriteTokens: 0, billingModelId: MODEL, ...expected });
    });
  });
}

import assert from "node:assert/strict";
import { test } from "node:test";

import { config } from "../../src/config.js";
import { createLlmProvider } from "../../src/llm/registry.js";
import { LLM_PROVIDER } from "../../src/llm/provider.ts";
import { makeConfigOverrides } from "../helpers.js";
import { DEEPSEEK_SCHLUESSEL_BEISPIEL } from "../gemeinsam/erfundene-geheimnisse.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const MODEL = "deepseek-v4-pro";

const answer = (usage) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage }),
  text: async () => "",
});

async function mitDeepseek(response, pruefung) {
  const seen = [];
  await withConfigOverrides(
    { llmProvider: LLM_PROVIDER.DEEPSEEK, deepseekApiKey: DEEPSEEK_SCHLUESSEL_BEISPIEL },
    async () => {
      const provider = createLlmProvider({
        chatCompletionsFetch: (url, init) => {
          seen.push(JSON.parse(init.body));
          return Promise.resolve(response);
        },
      });
      await pruefung(provider, seen);
    },
  );
}

const USAGE_TABLE = [
  {
    name: "vollstaendig und stimmig: gemeldet",
    usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6, completion_tokens: 2 },
    expected: { inputUncachedTokens: 6, inputCacheReadTokens: 4, outputTokens: 2, estimated: false },
  },
  {
    name: "Ausgabe fehlt: geschaetzt, Ausgabe 0, Eingabe aus prompt_tokens",
    usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6 },
    expected: { inputUncachedTokens: 10, inputCacheReadTokens: 0, outputTokens: 0, estimated: true },
  },
  {
    name: "Ausgabe nicht endlich: geschaetzt, Ausgabe 0",
    usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6, completion_tokens: Infinity },
    expected: { inputUncachedTokens: 10, inputCacheReadTokens: 0, outputTokens: 0, estimated: true },
  },
  {
    name: "prompt_tokens fehlt: geschaetzt, Eingabe aus Treffer plus Fehlgriff",
    usage: { prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6, completion_tokens: 2 },
    expected: { inputUncachedTokens: 10, inputCacheReadTokens: 0, outputTokens: 2, estimated: true },
  },
  {
    name: "Summe passt nicht zu prompt_tokens: geschaetzt",
    usage: { prompt_tokens: 11, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6, completion_tokens: 2 },
    expected: { inputUncachedTokens: 11, inputCacheReadTokens: 0, outputTokens: 2, estimated: true },
  },
  {
    name: "Treffer fehlt: geschaetzt",
    usage: { prompt_tokens: 10, prompt_cache_miss_tokens: 6, completion_tokens: 2 },
    expected: { inputUncachedTokens: 10, inputCacheReadTokens: 0, outputTokens: 2, estimated: true },
  },
  {
    name: "Fehlgriff fehlt: geschaetzt",
    usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 4, completion_tokens: 2 },
    expected: { inputUncachedTokens: 10, inputCacheReadTokens: 0, outputTokens: 2, estimated: true },
  },
];

for (const { name, usage, expected } of USAGE_TABLE) {
  test(`deepseek-wachen: Verbrauchsmeldung ${name}`, async () => {
    await mitDeepseek(answer(usage), async (provider) => {
      const turn = await provider.complete({ model: MODEL, messages: [{ role: "user", content: "x" }] });
      assert.deepEqual(turn.usage, { inputCacheWriteTokens: 0, billingModelId: MODEL, ...expected });
    });
  });
}

test("deepseek-wachen: cachePrefix und system stehen nicht als eigene Felder im Koerper, system wird erste Nachricht", async () => {
  await mitDeepseek(answer(undefined), async (provider, seen) => {
    await provider.complete({
      model: MODEL,
      cachePrefix: true,
      system: "Du bist Hermes.",
      messages: [{ role: "user", content: "x" }],
    });
    assert.deepEqual(Object.keys(seen[0]), ["model", "messages", "thinking"]);
    assert.deepEqual(seen[0].messages[0], { role: "system", content: "Du bist Hermes." });
  });
});

test("deepseek-wachen: tools ohne Wert scheitert lokal, ohne dass eine Anfrage rausgeht", async () => {
  await mitDeepseek(answer(undefined), async (provider, seen) => {
    await assert.rejects(provider.complete({ model: MODEL, tools: undefined, messages: [] }), {
      name: "TypeError",
      message: "DeepSeek-Adapter: tools fehlt",
    });
    assert.equal(seen.length, 0);
  });
});

test("deepseek-wachen: messages ohne Wert scheitert lokal, ohne dass eine Anfrage rausgeht", async () => {
  await mitDeepseek(answer(undefined), async (provider, seen) => {
    await assert.rejects(provider.complete({ model: MODEL, messages: undefined }), {
      name: "TypeError",
      message: "DeepSeek-Adapter: messages fehlt",
    });
    assert.equal(seen.length, 0);
  });
});

test("deepseek-wachen: Stream-Antwort ohne Rumpf scheitert mit TypeError statt mit einem Zugriffsfehler", async () => {
  const response = { ok: true, status: 200, body: null, text: async () => "" };
  await mitDeepseek(response, async (provider) => {
    const sink = { pushText: () => {}, toolUseStarted: () => {} };
    await assert.rejects(
      provider.completeStream({ model: MODEL, messages: [{ role: "user", content: "x" }] }, sink),
      { name: "TypeError", message: "DeepSeek-Adapter: Antwort ohne Stream" },
    );
  });
});

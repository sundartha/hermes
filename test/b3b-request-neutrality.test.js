import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnthropicProvider } from "../src/llm/adapters/anthropic.js";
import { LLM_TOOL_CHOICE, forcedTool } from "../src/llm/tool-choice.js";

function providerReturning(resp) {
  const seen = [];
  const provider = createAnthropicProvider({
    messagesCreate: (params) => {
      seen.push(params);
      return Promise.resolve(resp);
    },
  });
  return { provider, seen };
}

const MODEL = "claude-haiku-4-5";
const emptyResp = { content: [] };

test("B3B-2: maxTokens wird an DERSELBEN Position zu max_tokens; kein neutraler Schluessel entkommt", async () => {
  const { provider, seen } = providerReturning(emptyResp);
  await provider.complete({
    model: MODEL,
    maxTokens: 300,
    system: "s",
    tools: [],
    messages: [],
    toolChoice: LLM_TOOL_CHOICE.AUTO,
    cachePrefix: true,
  });
  const body = seen[0];
  assert.deepEqual(Object.keys(body), [
    "model",
    "max_tokens",
    "system",
    "tools",
    "messages",
    "tool_choice",
  ]);
  for (const neutralKey of ["maxTokens", "toolChoice", "cachePrefix", "parameters"])
    assert.ok(!(neutralKey in body), `${neutralKey} darf den Draht nicht erreichen`);
});

test("B3B-3: Werkzeugwahl dreiwertig - AUTO/REQUIRED/forcedTool in Anthropics Formen", async () => {
  const cases = [
    [LLM_TOOL_CHOICE.AUTO, { type: "auto" }],
    [LLM_TOOL_CHOICE.REQUIRED, { type: "any" }],
    [forcedTool("hintergrund"), { type: "tool", name: "hintergrund" }],
  ];
  for (const [toolChoice, expected] of cases) {
    const { provider, seen } = providerReturning(emptyResp);
    await provider.complete({ model: MODEL, messages: [], toolChoice });
    assert.deepEqual(seen[0].tool_choice, expected);
  }
});

test("B3B-4: eine unbekannte Werkzeugwahl wirft mit Kontext statt still name:undefined zu senden", async () => {
  const { provider } = providerReturning(emptyResp);
  for (const bad of [{}, "beliebig"])
    await assert.rejects(
      () => provider.complete({ model: MODEL, messages: [], toolChoice: bad }),
      /unbekannte Werkzeugwahl/,
    );
});

test("B3B-5: {name,description,parameters} -> {name,description,input_schema}; ohne parameters referenzgleich durch", async () => {
  const serverTool = { type: "web_search_20250305", name: "web_search", max_uses: 1 };
  const { provider, seen } = providerReturning(emptyResp);
  await provider.complete({
    model: MODEL,
    messages: [],
    tools: [
      { name: "hintergrund", description: "d", parameters: { type: "object" } },
      serverTool,
    ],
  });
  assert.deepEqual(seen[0].tools[0], {
    name: "hintergrund",
    description: "d",
    input_schema: { type: "object" },
  });
  assert.equal(seen[0].tools[1], serverTool, "ein Eintrag ohne parameters geht REFERENZGLEICH durch");
});

test("B3B-6: cachePrefix:true markiert System-Block + letztes Werkzeug, cachePrefix selbst fehlt im Body", async () => {
  const { provider, seen } = providerReturning(emptyResp);
  await provider.complete({
    model: MODEL,
    system: "Systemtext",
    tools: [
      { name: "a", description: "a", parameters: {} },
      { name: "b", description: "b", parameters: {} },
    ],
    messages: [],
    cachePrefix: true,
  });
  const body = seen[0];
  assert.deepEqual(body.system, [
    { type: "text", text: "Systemtext", cache_control: { type: "ephemeral" } },
  ]);
  assert.equal(body.tools[0].cache_control, undefined, "nur das LETZTE Werkzeug traegt die Marke");
  assert.deepEqual(body.tools[1].cache_control, { type: "ephemeral" });
  assert.ok(!("cachePrefix" in body), "cachePrefix ist ein Hinweis an den Adapter, kein Draht-Feld");
});

test("B3B-7: ohne cachePrefix bleibt system ein String und KEIN Werkzeug traegt eine Marke", async () => {
  const { provider, seen } = providerReturning(emptyResp);
  await provider.complete({
    model: MODEL,
    system: "Systemtext",
    tools: [{ name: "a", description: "a", parameters: {} }],
    messages: [],
  });
  const body = seen[0];
  assert.equal(body.system, "Systemtext");
  assert.equal(body.tools[0].cache_control, undefined);
});

test("B3B-8: leere Werkzeugliste mit cachePrefix:true bleibt leer, kein Absturz, keine Marke", async () => {
  const { provider, seen } = providerReturning(emptyResp);
  await provider.complete({ model: MODEL, tools: [], messages: [], cachePrefix: true });
  assert.deepEqual(seen[0].tools, []);
});

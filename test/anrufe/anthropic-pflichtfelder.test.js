import assert from "node:assert/strict";
import http from "node:http";
import { test, before, after } from "node:test";

import { ANTHROPIC_SCHLUESSEL_BEISPIEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { text, reply, makeJsonMessage, makeWriteSse } from "../anthropic-sse-fixtures.js";

const MODEL = "claude-haiku-4-5";
const PFLICHTFELD_FEHLT = /Anthropic-Adapter: Pflichtfeld fehlt/;
const jsonMessage = makeJsonMessage("msg_pflichtfelder");
const writeSse = makeWriteSse(jsonMessage);

let server;
let received = [];
let createLlmProvider;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw);
      received.push(body);
      const blocks = reply(text("Antwort")).blocks;
      if (body.stream === true) return writeSse(res, blocks);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(jsonMessage(blocks)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = ANTHROPIC_SCHLUESSEL_BEISPIEL;
  ({ createLlmProvider } = await import("../../src/llm/registry.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

const sink = { pushText() {}, toolUseStarted() {} };
const ganzeAnfrage = { model: MODEL, maxTokens: 16, messages: [] };
const ohneFeld = [
  ["model kein String", { ...ganzeAnfrage, model: 42 }],
  ["max_tokens keine Zahl", { model: MODEL, messages: [] }],
  ["messages kein Array", { model: MODEL, maxTokens: 16 }],
];

for (const [name, request] of ohneFeld) {
  test(`Pflichtfelder: ${name} scheitert lokal und erreicht den Anbieter nicht (complete)`, async () => {
    received = [];
    await assert.rejects(createLlmProvider().complete(request), PFLICHTFELD_FEHLT);
    assert.equal(received.length, 0);
  });

  test(`Pflichtfelder: ${name} scheitert lokal und erreicht den Anbieter nicht (Stream)`, async () => {
    received = [];
    await assert.rejects(createLlmProvider().completeStream(request, sink), PFLICHTFELD_FEHLT);
    assert.equal(received.length, 0);
  });
}

test("Pflichtfelder: eine vollstaendige Anfrage erreicht den Anbieter (complete und Stream)", async () => {
  received = [];
  const provider = createLlmProvider();
  const turn = await provider.complete(ganzeAnfrage);
  await provider.completeStream(ganzeAnfrage, sink);
  assert.equal(turn.text, "Antwort");
  assert.equal(received.length, 2);
  assert.equal(received[0].model, MODEL);
  assert.equal(received[0].max_tokens, 16);
  assert.deepEqual(received[0].messages, []);
});

test("Wachen: ein vorhandener Schluessel tools ohne Wert nennt tools als Ursache", async () => {
  const provider = createLlmProvider({ messagesCreate: () => Promise.resolve({}) });
  await assert.rejects(
    provider.complete({ model: MODEL, messages: [], tools: undefined }),
    new TypeError("Anthropic-Adapter: tools fehlt"),
  );
});

test("Wachen: ein vorhandener Schluessel messages ohne Wert nennt messages als Ursache", async () => {
  const provider = createLlmProvider({ messagesCreate: () => Promise.resolve({}) });
  await assert.rejects(
    provider.complete({ model: MODEL, messages: undefined }),
    new TypeError("Anthropic-Adapter: messages fehlt"),
  );
});

function providerReturning(resp) {
  const seen = [];
  const provider = createLlmProvider({
    messagesCreate: (params) => {
      seen.push(params);
      return Promise.resolve(resp);
    },
  });
  return { provider, seen };
}

const usageTabelle = [
  ["Eingabe ohne Ausgabe", { input_tokens: 5 }],
  ["Ausgabe ohne Eingabe", { output_tokens: 5 }],
  ["kein usage", undefined],
];

for (const [name, usage] of usageTabelle) {
  test(`Verbrauch: ${name} gilt als nicht gemeldet`, async () => {
    const { provider } = providerReturning({ content: [], usage });
    const turn = await provider.complete({ model: MODEL, messages: [] });
    assert.deepEqual(turn.usage, {
      inputUncachedTokens: 0,
      inputCacheWriteTokens: 0,
      inputCacheReadTokens: 0,
      outputTokens: 0,
      estimated: true,
      billingModelId: MODEL,
    });
  });
}

test("Antwort: ohne Antwort und ohne Inhaltsliste gibt es keinen Text und keine Werkzeugaufrufe", async () => {
  for (const resp of [undefined, {}, { content: "kein Array" }]) {
    const { provider } = providerReturning(resp);
    const turn = await provider.complete({ model: MODEL, messages: [] });
    assert.equal(turn.text, "");
    assert.deepEqual(turn.toolCalls, []);
  }
});

test("Antwort: eine frueher gemerkte Antwort ohne Inhaltsliste wird mit leerem Inhalt zurueckgeschickt", async () => {
  const { provider, seen } = providerReturning({ content: [] });
  await provider.complete({
    model: MODEL,
    messages: [{ role: "assistant", providerTurn: {} }],
  });
  assert.deepEqual(seen[0].messages, [{ role: "assistant", content: [] }]);
});

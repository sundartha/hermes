import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { isTransient } from "../src/llm.js";

function anthropicMessage(text) {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 16 },
  };
}

function endPremature(res) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.setHeader("transfer-encoding", "chunked");
  res.write('{"id":"msg_mock","type":"message"');
  res.socket.destroy();
}

function endValid(res, text) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(anthropicMessage(text)));
}

async function startMock(handler) {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => handler(res));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

function createParams() {
  return { model: "claude-haiku-4-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] };
}

test("L-CP7-1: new Anthropic({apiKey,timeout,maxRetries}) + messages.create vorhanden", () => {
  const client = new Anthropic({ apiKey: "x", timeout: 3000, maxRetries: 0 });
  assert.equal(typeof client.messages.create, "function");
});

test("L-CP7-2: Anthropic.APIConnectionError ist eine Klasse, instanceof greift", () => {
  assert.equal(typeof Anthropic.APIConnectionError, "function");
  const err = new Anthropic.APIConnectionError({ message: "x" });
  assert.ok(err instanceof Anthropic.APIConnectionError);
});

test("L-CP7-3: abgebrochener Body -> APIConnectionError mit cause-Kette (neue SDK-Shape)", async () => {
  const mock = await startMock((res) => endPremature(res));
  try {
    const client = new Anthropic({ apiKey: "x", baseURL: mock.url, timeout: 3000, maxRetries: 0 });
    await assert.rejects(
      () => client.messages.create(createParams()),
      (err) =>
        err instanceof Anthropic.APIConnectionError && err.cause?.cause?.code === "UND_ERR_SOCKET",
    );
  } finally {
    await mock.close();
  }
});

test("L-CP7-4: isTransient(echter neuer Premature-close-Error) === true", async () => {
  const mock = await startMock((res) => endPremature(res));
  let captured;
  try {
    const client = new Anthropic({ apiKey: "x", baseURL: mock.url, timeout: 3000, maxRetries: 0 });
    try {
      await client.messages.create(createParams());
      assert.fail("erwartet: abgebrochener Body wirft");
    } catch (err) {
      captured = err;
    }
  } finally {
    await mock.close();
  }
  assert.equal(isTransient(captured), true);
});

test("L-CP7-5: messages.create liefert {usage:{input_tokens,output_tokens}, content:[...]}", async () => {
  const speech = "Ich rufe im Auftrag an und haette eine kurze Frage.";
  const mock = await startMock((res) => endValid(res, speech));
  try {
    const client = new Anthropic({ apiKey: "x", baseURL: mock.url, timeout: 3000, maxRetries: 0 });
    const resp = await client.messages.create(createParams());
    assert.equal(typeof resp.usage.input_tokens, "number");
    assert.equal(typeof resp.usage.output_tokens, "number");
    assert.ok(Array.isArray(resp.content));
    assert.equal(resp.content[0].type, "text");
    assert.equal(resp.content[0].text, speech);
  } finally {
    await mock.close();
  }
});

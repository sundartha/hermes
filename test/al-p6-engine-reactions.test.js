import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { localeFor } from "../src/i18n/locales.js";
import { startServer, seedState, seedCall } from "./helpers.js";

const TOKENS_OVER_TENANT_CAP = 40_000_000;

function anthropicMessage(content, inputTokens) {
  return {
    id: "msg_alp6_engine",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: 5 },
  };
}

async function startAnthropicMock(payload) {
  const requests = { count: 0 };
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      requests.count += 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

async function runTurn(srv, id) {
  const opening = await fetch(`${srv.localUrl}/voice/outbound?callId=${id}`, {
    method: "POST",
    body: new URLSearchParams({ CallSid: "CAtest" }),
  });
  assert.equal(opening.status, 200);
  const turn = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
    method: "POST",
    body: new URLSearchParams({ SpeechResult: "Ja, Donnerstag passt gut" }),
  });
  return await turn.text();
}

test("AL-P6-10: Budget-Engine - der im Turn gerissene Cap beendet den Call mit Ansage", async () => {
  const id = "call_alp6_engine";
  const mock = await startAnthropicMock(
    anthropicMessage(
      [{ type: "tool_use", id: "tu1", name: "look_up_not_yet_built", input: {} }],
      TOKENS_OVER_TENANT_CAP,
    ),
  );
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url },
    seed: seedState({ calls: [seedCall({ id, provider: "telnyx", direction: "outbound" })] }),
  });
  try {
    const body = await runTurn(srv, id);

    assert.equal(mock.requests.count, 1, "keine zweite, bereits gebuchte Runde");
    assert.ok(
      body.includes(localeFor("de").budgetExhaustedHangup),
      `Abschluss-Ansage erwartet: ${body}`,
    );
    assert.match(body, /<Hangup/);
    assert.match(srv.stdout, /\[turn\] abbruch grund=budget_tenant/);
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test("AL-P6-11: Budget-Engine - normaler Verbrauch laesst das Gespraech weiterlaufen", async () => {
  const id = "call_alp6_engine_ok";
  const speech = "Gerne, ich pruefe das.";
  const mock = await startAnthropicMock(anthropicMessage([{ type: "text", text: speech }], 12));
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url },
    seed: seedState({ calls: [seedCall({ id, provider: "telnyx", direction: "outbound" })] }),
  });
  try {
    const body = await runTurn(srv, id);

    assert.ok(body.includes(speech), `Modelltext erwartet: ${body}`);
    assert.match(body, /<Gather/);
    assert.doesNotMatch(body, /<Hangup/);
  } finally {
    await srv.stop();
    await mock.close();
  }
});

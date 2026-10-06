import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, seedCall } from "./helpers.js";

function endCallMessage(speech) {
  return {
    id: "msg_g326_endcall",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [
      { type: "text", text: speech },
      { type: "tool_use", id: "tu1", name: "end_call", input: {} },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 8, output_tokens: 6 },
  };
}

async function startEndCallMock() {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(endCallMessage("Ich lege jetzt auf.")));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

test("G3/G26 Runde 2: Rausch-Turn dann echte Dauerstille - der R4-Deadlock-Schutz bleibt ueber /voice/turn erreichbar", async () => {
  const mock = await startEndCallMock();
  const id = "call_g326_shortcut";
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url, MAX_EMPTY_TURNS: "2" },
    seed: seedState({
      calls: [seedCall({ id, provider: "telnyx", status: "active", direction: "outbound" })],
    }),
  });
  try {
    const openRes = await fetch(`${srv.localUrl}/voice/outbound?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest" }),
    });
    assert.equal(openRes.status, 200);

    const noiseRes = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "." }),
    });
    const noiseBody = await noiseRes.text();
    assert.match(noiseBody, /<Gather/, `Rausch-Turn muss weiterlaufen: ${noiseBody}`);
    assert.doesNotMatch(
      noiseBody,
      /<Hangup/,
      `Rausch darf end_call nicht freigeben (R2): ${noiseBody}`,
    );

    const silentRes = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "" }),
    });
    const silentBody = await silentRes.text();
    assert.match(
      silentBody,
      /<Hangup/,
      `nach maxEmptyTurns muss der Guard trotz Rausch-Historie auflegen: ${silentBody}`,
    );

    const stored = srv.readStore();
    const call = stored.calls.find((c) => c.id === id);
    const callerLines = call.transcript.filter((t) => t.role === "caller");
    assert.equal(callerLines.length, 1);
    assert.equal(callerLines[0].text, ".");
  } finally {
    await srv.stop();
    await mock.close();
  }
});

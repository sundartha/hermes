import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, seedCall } from "./helpers.js";

function textMessage(text) {
  return {
    id: "msg_p3c_text",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 8, output_tokens: 6 },
  };
}

async function startTextMock(speech) {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(textMessage(speech)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

test("P3-C1: Restzeit unter CAP_FAREWELL_LEAD_MS -> Abschluss-Satz + Hangup statt Folge-Gather", async () => {
  const mock = await startTextMock("Und wie lange dauert das ungefaehr?");
  const id = "call_p3c1";
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url, CAP_FAREWELL_LEAD_MS: "20000" },
    seed: seedState({
      calls: [
        seedCall({
          id,
          provider: "telnyx",
          status: "active",
          direction: "outbound",
          maxDurationS: 20,
          transcript: [{ role: "caller", text: "Ja gerne" }],
        }),
      ],
    }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Und wie lange dauert das?" }),
    });
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(
      body,
      /<Say[^>]*>Ich muss das Gespräch jetzt leider beenden\. Vielen Dank für Ihre Zeit\. Auf Wiederhören\.<\/Say>/,
    );
    assert.match(body, /<Hangup/);
    assert.doesNotMatch(body, /<Gather/, `Cap-Vorlauf darf keinen Folge-Gather rendern: ${body}`);
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test("P3-C2 (Gegenprobe): grosszuegige Restzeit -> normaler Turn, kein Cap-Abschied", async () => {
  const mock = await startTextMock("Und wie lange dauert das ungefaehr?");
  const id = "call_p3c2";
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url, CAP_FAREWELL_LEAD_MS: "20000" },
    seed: seedState({
      calls: [
        seedCall({
          id,
          provider: "telnyx",
          status: "active",
          direction: "outbound",
          maxDurationS: 180,
          transcript: [{ role: "caller", text: "Ja gerne" }],
        }),
      ],
    }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Und wie lange dauert das?" }),
    });
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(body, /<Gather/);
    assert.doesNotMatch(body, /<Hangup/);
    assert.doesNotMatch(
      body,
      /Ich muss das Gespräch jetzt leider beenden/,
      `Cap-Abschied darf bei grosszuegiger Restzeit nicht rendern: ${body}`,
    );
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test("P3-COV1: leerer Gather UND Restzeit unter CAP_FAREWELL_LEAD_MS -> Abschluss-Satz statt Staffel-Stufe-1", async () => {
  const id = "call_p3cov1";
  const srv = await startServer({
    env: { CAP_FAREWELL_LEAD_MS: "20000" },
    seed: seedState({
      calls: [
        seedCall({
          id,
          provider: "telnyx",
          status: "active",
          direction: "outbound",
          maxDurationS: 20,
          transcript: [{ role: "caller", text: "..." }],
        }),
      ],
    }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "" }),
    });
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(
      body,
      /<Say[^>]*>Ich muss das Gespräch jetzt leider beenden\. Vielen Dank für Ihre Zeit\. Auf Wiederhören\.<\/Say>/,
    );
    assert.match(body, /<Hangup/);
    assert.doesNotMatch(body, /<Gather/, `Cap-Vorlauf darf keinen Folge-Gather rendern: ${body}`);
    assert.doesNotMatch(
      body,
      /Können Sie das bitte wiederholen/,
      `Staffel-Stufe-1 darf bei knapper Restzeit nicht rendern, der Cap-Vorlauf muss gewinnen: ${body}`,
    );
  } finally {
    await srv.stop();
  }
});

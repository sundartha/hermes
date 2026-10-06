import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, seedCall } from "./helpers.js";

function textMessage(text) {
  return {
    id: "msg_g4c_text",
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

test("G4: leerer Gather nach bereits-gesprochenem Caller -> knappe Rueckfrage, kein Hangup", async () => {
  const id = "call_g4";
  const srv = await startServer({
    seed: seedState({
      calls: [
        seedCall({
          id,
          provider: "telnyx",
          status: "active",
          direction: "outbound",
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
    assert.match(body, /<Say[^>]*>Können Sie das bitte wiederholen\?<\/Say>/);
    assert.match(body, /<Gather/);
    assert.doesNotMatch(body, /<Hangup/);
  } finally {
    await srv.stop();
  }
});

test("P3-G4b: drei aufeinanderfolgende leere Gathers -> drei verschiedene Antworten, dritte legt auf", async () => {
  const id = "call_p3g4b";
  const srv = await startServer({
    seed: seedState({
      calls: [
        seedCall({
          id,
          provider: "telnyx",
          status: "active",
          direction: "outbound",
          transcript: [{ role: "caller", text: "..." }],
        }),
      ],
    }),
  });
  try {
    const turnTexts = [];
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
        method: "POST",
        body: new URLSearchParams({ SpeechResult: "" }),
      });
      turnTexts.push(await res.text());
    }

    assert.match(turnTexts[0], /<Say[^>]*>Können Sie das bitte wiederholen\?<\/Say>/);
    assert.match(turnTexts[0], /<Gather/);
    assert.doesNotMatch(turnTexts[0], /<Hangup/);

    assert.match(
      turnTexts[1],
      /<Say[^>]*>Ich höre Sie leider immer noch nicht\. Sind Sie noch in der Leitung\?<\/Say>/,
    );
    assert.match(turnTexts[1], /<Gather/);
    assert.doesNotMatch(turnTexts[1], /<Hangup/);

    assert.match(
      turnTexts[2],
      /<Say[^>]*>Ich kann Sie leider nicht hören\. Ich versuche es später noch einmal\. Auf Wiederhören\.<\/Say>/,
    );
    assert.match(turnTexts[2], /<Hangup/);
    assert.doesNotMatch(turnTexts[2], /<Gather/);

    assert.notEqual(turnTexts[0], turnTexts[1]);
    assert.notEqual(turnTexts[1], turnTexts[2]);
    assert.notEqual(turnTexts[0], turnTexts[2]);
  } finally {
    await srv.stop();
  }
});

test("P3-G4c: eine verstandene Aeusserung setzt die Staffel zurueck (konsekutiv, nicht kumulativ)", async () => {
  const mock = await startTextMock("Alles klar, einen Moment.");
  const id = "call_p3g4c";
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url },
    seed: seedState({
      calls: [
        seedCall({
          id,
          provider: "telnyx",
          status: "active",
          direction: "outbound",
          transcript: [{ role: "caller", text: "..." }],
        }),
      ],
    }),
  });
  try {
    const t1 = await (
      await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
        method: "POST",
        body: new URLSearchParams({ SpeechResult: "" }),
      })
    ).text();
    assert.match(t1, /<Say[^>]*>Können Sie das bitte wiederholen\?<\/Say>/);

    const t2res = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Ja bitte" }),
    });
    assert.equal(t2res.status, 200);
    const t2 = await t2res.text();
    assert.doesNotMatch(t2, /<Hangup/);

    const t3 = await (
      await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
        method: "POST",
        body: new URLSearchParams({ SpeechResult: "" }),
      })
    ).text();
    assert.match(t3, /<Say[^>]*>Können Sie das bitte wiederholen\?<\/Say>/);
    assert.doesNotMatch(t3, /<Hangup/);

    const t4 = await (
      await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
        method: "POST",
        body: new URLSearchParams({ SpeechResult: "" }),
      })
    ).text();
    assert.match(
      t4,
      /<Say[^>]*>Ich höre Sie leider immer noch nicht\. Sind Sie noch in der Leitung\?<\/Say>/,
    );
    assert.doesNotMatch(t4, /<Hangup/);
  } finally {
    await srv.stop();
    await mock.close();
  }
});

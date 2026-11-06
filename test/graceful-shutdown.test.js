import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { startServer, seedState, seedCall } from "./helpers.js";
import { makeGracefulShutdown } from "../src/boot.js";
import { makeJsonMessage, text } from "./anthropic-sse-fixtures.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";

const LLM_DELAY_MS = 800;
const AGENT_SPEECH = "Ich rufe im Auftrag von Jonas an und haette eine kurze Frage.";

const anthropicMessage = (antwort) => makeJsonMessage("msg_mock")([text(antwort)]);

async function startDelayingAnthropicMock() {
  let signalRequested;
  const whenRequested = new Promise((r) => (signalRequested = r));
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      signalRequested();
      setTimeout(() => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(anthropicMessage(AGENT_SPEECH)));
      }, LLM_DELAY_MS);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    whenRequested,
    close: () => new Promise((r) => server.close(r)),
  };
}

test("SIGTERM mid-flight: /voice/turn laeuft fertig (200 TwiML), Transkript persistiert, exit 0", async () => {
  const mock = await startDelayingAnthropicMock();
  const id = "call_shutdown1";
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mock.url },
    seed: seedState({
      calls: [
        seedCall({
          id,
          status: "active",
          direction: "outbound",
          answeredAt: new Date().toISOString(),
        }),
      ],
    }),
  });
  try {
    const turnPromise = abrufMitFrist(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Hallo, worum geht es?" }),
    });
    const exitPromise = new Promise((resolve) => srv.child.once("exit", (code) => resolve(code)));

    await mock.whenRequested;
    srv.child.kill("SIGTERM");

    const [turnRes, exitCode] = await Promise.all([turnPromise, exitPromise]);
    const turnBody = await turnRes.text();

    assert.equal(turnRes.status, 200, "in-flight /voice/turn muss 200 liefern (nicht abgeschnitten)");
    assert.ok(turnBody.includes("</Response>"), `TwiML muss vollstaendig sein: ${turnBody}`);
    assert.equal(exitCode, 0, "Graceful Shutdown -> Exit 0 (nicht 143 SIGTERM-Kill)");

    const persisted = srv.readStore().calls.find((c) => c.id === id);
    assert.ok(
      persisted.transcript.some((t) => t.role === "agent" && t.text === AGENT_SPEECH),
      `Agent-Turn muss nach Exit persistiert sein: ${JSON.stringify(persisted.transcript)}`,
    );
  } finally {
    if (srv.child.exitCode === null) srv.child.kill("SIGKILL");
    await mock.close();
  }
});

function fakeHttpServer() {
  return { close: (cb) => cb(), closeIdleConnections() {} };
}
const FAKE_CONFIG = { server: { shutdownDrainTimeoutMs: 10000 } };

test("S1-2: gracefulShutdown -> rejectender finaler Flush = genau ein exit(1) + lauter Alarm", async () => {
  const exits = [];
  const errors = [];
  const shutdown = makeGracefulShutdown({
    httpServer: fakeHttpServer(),
    store: {
      save: async () => {},
      drainFlushes: async () => {
        throw new Error("DB weg (Test)");
      },
    },
    config: FAKE_CONFIG,
    exit: (c) => exits.push(c),
    log: () => {},
    logError: (m) => errors.push(m),
  });
  await shutdown("SIGTERM");
  assert.deepEqual(exits, [1], "fehlgeschlagener finaler Flush -> genau ein exit(1), kein Fall-through");
  assert.ok(errors.some((m) => /FEHLGESCHLAGEN/.test(m)), "lauter Datenverlust-Alarm");
});

test("S1-2: gracefulShutdown -> erfolgreicher finaler Flush = genau ein exit(0)", async () => {
  const exits = [];
  const shutdown = makeGracefulShutdown({
    httpServer: fakeHttpServer(),
    store: { save: async () => {}, drainFlushes: async () => {} },
    config: FAKE_CONFIG,
    exit: (c) => exits.push(c),
    log: () => {},
    logError: () => {},
  });
  await shutdown("SIGTERM");
  assert.deepEqual(exits, [0], "sauberer Flush -> genau ein exit(0)");
});

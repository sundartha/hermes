// A6 (F11): Graceful Shutdown - MID-FLIGHT-Test. Ohne SIGTERM/SIGINT-Handler killt Node
// den Prozess sofort -> ein in-flight /voice/turn stirbt mitten im LLM-await (kein TwiML,
// kein persistiertes Agent-Transkript). Eigene Spawn-Datei (kein pglite darin - Lehre p6a).
// Nutzt startServer/seedState/seedCall aus helpers.js (G5, keine Spawn-Duplizierung); der
// verzoegernde Anthropic-Mock ist inline, weil die Shared-Mocks in _outbound-harness.js
// nicht verzoegern (kein Fixture fuer "haengt waehrend SIGTERM eintrifft").
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { startServer, seedState, seedCall } from "./helpers.js";

const LLM_DELAY_MS = 800; // Handler haengt hier im await, waehrend SIGTERM eintrifft
const AGENT_SPEECH = "Ich rufe im Auftrag von Jonas an und haette eine kurze Frage.";

// Minimale valide Anthropic-Message (agentTurn liest content + usage; usage PFLICHT).
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

// Mock-Anthropic: signalisiert per whenRequested den Request-Eingang (= Handler steckt im
// LLM-await), wartet dann LLM_DELAY_MS und antwortet valide -> SIGTERM landet garantiert
// mid-flight, nicht vor/nach dem LLM-Call. http.createServer routet pfad-agnostisch, faengt
// also das POST /v1/messages des SDK.
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
    // ANTHROPIC_BASE_URL lenkt das SDK auf den Mock. LLM_REQUEST_TIMEOUT_MS (BASE_ENV 3500)
    // > 800 -> kein Timeout/Retry; valide Antwort -> genau EIN LLM-Call.
    env: { ANTHROPIC_BASE_URL: mock.url },
    seed: seedState({
      calls: [
        seedCall({
          id,
          status: "active",
          direction: "outbound",
          answeredAt: new Date().toISOString(), // frisch beantwortet -> Boot-Re-Arm (F10) haelt ihn aktiv
        }),
      ],
    }),
  });
  try {
    // in-flight: NICHT awaiten - der Handler bleibt im LLM-await haengen.
    const turnPromise = fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Hallo, worum geht es?" }),
    });
    const exitPromise = new Promise((resolve) => srv.child.once("exit", (code) => resolve(code)));

    await mock.whenRequested; // Handler steckt jetzt im LLM-Call
    srv.child.kill("SIGTERM"); // Signal landet mid-flight

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

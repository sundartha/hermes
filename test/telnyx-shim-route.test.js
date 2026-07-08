// Spawn/Wiring-Tests fuer den Telnyx Brain-Shim (PLAN-TELNYX-AI-ASSISTANT.md, P1):
// beweisen die Route-Registrierung in src/server.js (Mount VOR der Basic-Auth,
// Body-Parsing, lebende store.getCall-Referenz end-to-end). Unit-Verhalten (C1-C5,
// D3, D8) steht in test/telnyx-llm-shim.test.js - hier nur der HTTP-/Wiring-Beweis.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";
import { startCountingAnthropicMock, AGENT_SPEECH } from "./_outbound-harness.js";

const ROUTE = "/v1/chat/completions";
// P10: assertConfig verlangt bei aktivem Flag ASSISTANT_ID/API_KEY/CONNECTION_ID
// (fail-closed Boot) - beide Flag-an-Tests unten brauchen die drei Werte NUR damit der
// Server ueberhaupt startet, nicht fuer ihre eigentliche Aussage.
const TELNYX_ASSISTANT_BOOT_ENV = {
  TELNYX_ASSISTANT_ID: "asst_x",
  TELNYX_API_KEY: "key_x",
  TELNYX_CONNECTION_ID: "conn_x",
};

test("Flag aus (BASE_ENV-Default) -> 404 (beweist Mount + Route existiert, Flag-Gate greift HTTP-seitig)", async () => {
  const srv = await startServer({});
  try {
    const res = await fetch(`${srv.localUrl}${ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 404);
  } finally {
    await srv.stop();
  }
});

test("Basic-Auth-Exemption: Flag an, DASHBOARD_PASSWORD gesetzt, kein Authorization -> 403 (NICHT 401)", async () => {
  // 403 statt 401 beweist: die Route liegt VOR der Basic-Auth-Middleware und laeuft
  // durch ihre EIGENE fail-closed Absicherung, nicht durch die Dashboard-Auth.
  const srv = await startServer({
    env: { TELNYX_AI_ASSISTANT_ENABLED: "true", DASHBOARD_PASSWORD: "secret", ...TELNYX_ASSISTANT_BOOT_ENV },
  });
  try {
    const res = await fetch(`${srv.localUrl}${ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 403);
  } finally {
    await srv.stop();
  }
});

test("C3 end-to-end: gueltiges per-Call-Token -> 200 SSE mit agentTurn-Ergebnis", async () => {
  const mock = await startCountingAnthropicMock({ failFirst: 0 });
  const callId = "call_shim1";
  const srv = await startServer({
    env: { TELNYX_AI_ASSISTANT_ENABLED: "true", ANTHROPIC_BASE_URL: mock.url, ...TELNYX_ASSISTANT_BOOT_ENV },
    seed: seedState({
      calls: [
        seedCall({
          id: callId,
          aiAssistantToken: "sec-per-call",
          direction: "outbound",
          status: "active",
        }),
      ],
    }),
  });
  try {
    const res = await fetch(`${srv.localUrl}${ROUTE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${callId}:sec-per-call`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hallo" }],
      }),
    });
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type").includes("text/event-stream"));
    assert.ok(body.includes(AGENT_SPEECH), `Body muss agentTurn-Text enthalten:\n${body}`);
    assert.ok(body.includes("data: [DONE]"), `Body muss [DONE] enthalten:\n${body}`);
  } finally {
    await srv.stop();
    await mock.close();
  }
});

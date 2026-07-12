// Spawn/Wiring-Tests fuer den Telnyx Brain-Shim (PLAN-TELNYX-AI-ASSISTANT.md, P1):
// beweisen die Route-Registrierung in src/server.js (Mount VOR der Basic-Auth,
// Body-Parsing, lebende store.getCallByControlId-Referenz end-to-end). Unit-Verhalten
// (Auth/Korrelation/Budget/Fehler) steht in test/telnyx-llm-shim.test.js - hier nur
// der HTTP-/Wiring-Beweis.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  seedState,
  seedCall,
  TELNYX_ASSISTANT_BOOT_ENV,
} from "./helpers.js";
import { startCountingAnthropicMock, AGENT_SPEECH } from "./_outbound-harness.js";

const ROUTE = "/v1/chat/completions";

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

test("C3 end-to-end: gueltiger Shim-Bearer + ccid + stream:true -> 200 SSE mit agentTurn-Ergebnis", async () => {
  const mock = await startCountingAnthropicMock({ failFirst: 0 });
  const callId = "call_shim1";
  const callControlId = "cc_route1";
  const srv = await startServer({
    env: { TELNYX_AI_ASSISTANT_ENABLED: "true", ANTHROPIC_BASE_URL: mock.url, ...TELNYX_ASSISTANT_BOOT_ENV },
    seed: seedState({
      calls: [
        seedCall({
          id: callId,
          callControlId,
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
        authorization: `Bearer ${TELNYX_ASSISTANT_BOOT_ENV.TELNYX_SHIM_SHARED_SECRET}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        stream: true,
        messages: [{ role: "user", content: "Hallo" }],
        extra_metadata: { call_control_id: callControlId },
      }),
    });
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type").includes("text/event-stream"));
    assert.ok(body.includes(AGENT_SPEECH), `Body muss agentTurn-Text enthalten:\n${body}`);
    assert.ok(body.includes("chat.completion.chunk"), `Body muss SSE-Chunk-Shape enthalten:\n${body}`);
    assert.ok(body.includes("delta"), `Body muss delta-Framing enthalten:\n${body}`);
    assert.ok(body.includes("data: [DONE]"), `Body muss [DONE] enthalten:\n${body}`);
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test("stab-p6 JSON end-to-end: gueltiger Shim-Bearer + ccid + stream:false -> 200 plain chat.completion-JSON", async () => {
  const mock = await startCountingAnthropicMock({ failFirst: 0 });
  const callId = "call_shim2";
  const callControlId = "cc_route2";
  const srv = await startServer({
    env: { TELNYX_AI_ASSISTANT_ENABLED: "true", ANTHROPIC_BASE_URL: mock.url, ...TELNYX_ASSISTANT_BOOT_ENV },
    seed: seedState({
      calls: [
        seedCall({
          id: callId,
          callControlId,
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
        authorization: `Bearer ${TELNYX_ASSISTANT_BOOT_ENV.TELNYX_SHIM_SHARED_SECRET}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        stream: false,
        messages: [{ role: "user", content: "Hallo" }],
        extra_metadata: { call_control_id: callControlId },
      }),
    });
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type").includes("application/json"));
    const parsed = JSON.parse(body);
    assert.equal(parsed.object, "chat.completion");
    assert.ok(parsed.choices[0].message.content.includes(AGENT_SPEECH), `message.content muss agentTurn-Text enthalten:\n${body}`);
    assert.ok(!body.includes("data: [DONE]"), `JSON-Modus darf kein SSE-Framing enthalten:\n${body}`);
  } finally {
    await srv.stop();
    await mock.close();
  }
});

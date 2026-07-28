// AL-P8: der Gate-Beweis end-to-end fuer den Shim-Bench-Treiber (Muster
// test/telnyx-shim-route.test.js). KEIN Bypass: der Server zieht die vollen vier
// Shim-Gates (Existenz-Flag ueber TELNYX_AI_ASSISTANT_ENABLED bereits in
// telnyx-shim-route.test.js bewiesen; hier Bearer/ccid-Korrelation/Erfolg + die
// answered->speak->speak.ended->ai_assistant_start-Choreografie + hangup-Settlement).
// Wegwerf-Werte aus TELNYX_ASSISTANT_BOOT_ENV (test/helpers.js, EINE Quelle), nie
// Prod-Secrets. json-Backend (Default), kein pglite-Mix (Lehre p6a).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  seedState,
  seedCall,
  waitForStoreState,
  TELNYX_ASSISTANT_BOOT_ENV,
  OWNER_TEST_FIRST_NAME,
  OWNER_TEST_LAST_NAME,
} from "./helpers.js";
import { startCountingAnthropicMock, AGENT_SPEECH } from "./_outbound-harness.js";
import { shimTurnRequest, completionSpeech } from "../scripts/convo-bench/driver-shim.mjs";
import { startTelnyxFake, callControlEventBody } from "../scripts/convo-bench/telnyx-fake.mjs";
import { expectedDisclosure } from "../scripts/convo-bench/checks.mjs";

const CALL_CONTROL_ID = "cc_bench_gate";
const SHIM_ROUTE = "/v1/chat/completions";

function shimEnv(extra = {}) {
  return { TELNYX_AI_ASSISTANT_ENABLED: "true", ...TELNYX_ASSISTANT_BOOT_ENV, ...extra };
}

async function postCallControlEvent(srv, callId, opts) {
  return fetch(`${srv.localUrl}/voice/call-control?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(callControlEventBody(opts)),
  });
}

test("AL-P8-23 Bench-Shim-Request OHNE Bearer -> 403 (Gate scharf)", async () => {
  const srv = await startServer({
    env: shimEnv(),
    seed: seedState({ calls: [seedCall({ callControlId: CALL_CONTROL_ID, status: "active" })] }),
  });
  try {
    const res = await fetch(`${srv.localUrl}${SHIM_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        stream: true,
        messages: [{ role: "user", content: "Hallo" }],
        extra_metadata: { call_control_id: CALL_CONTROL_ID },
      }),
    });
    assert.equal(res.status, 403);
  } finally {
    await srv.stop();
  }
});

test("AL-P8-24 Bench-Shim-Request mit FALSCHEM Bearer -> 403 (Gate scharf, safeEqual)", async () => {
  const srv = await startServer({
    env: shimEnv(),
    seed: seedState({ calls: [seedCall({ callControlId: CALL_CONTROL_ID, status: "active" })] }),
  });
  try {
    const req = shimTurnRequest({
      baseUrl: srv.localUrl,
      secret: "definitiv-falsches-secret",
      callControlId: CALL_CONTROL_ID,
      text: "Hallo",
      model: "gpt-4o-mini",
    });
    const res = await fetch(req.url, req.init);
    assert.equal(res.status, 403);
  } finally {
    await srv.stop();
  }
});

test("AL-P8-25 Bench-Shim-Request mit gueltigem Bearer, aber fremder call_control_id -> 403 (ccid-Korrelation)", async () => {
  const srv = await startServer({
    env: shimEnv(),
    seed: seedState({ calls: [seedCall({ callControlId: CALL_CONTROL_ID, status: "active" })] }),
  });
  try {
    const req = shimTurnRequest({
      baseUrl: srv.localUrl,
      secret: TELNYX_ASSISTANT_BOOT_ENV.TELNYX_SHIM_SHARED_SECRET,
      callControlId: "cc_fremd",
      text: "Hallo",
      model: "gpt-4o-mini",
    });
    const res = await fetch(req.url, req.init);
    assert.equal(res.status, 403);
  } finally {
    await srv.stop();
  }
});

test("AL-P8-26 Bench-Shim-Request mit gueltigem Bearer + geseedetem aktivem Call -> 200 mit Agenten-Text", async () => {
  const mock = await startCountingAnthropicMock({ failFirst: 0 });
  const srv = await startServer({
    env: shimEnv({ ANTHROPIC_BASE_URL: mock.url }),
    seed: seedState({ calls: [seedCall({ callControlId: CALL_CONTROL_ID, status: "active" })] }),
  });
  try {
    const req = shimTurnRequest({
      baseUrl: srv.localUrl,
      secret: TELNYX_ASSISTANT_BOOT_ENV.TELNYX_SHIM_SHARED_SECRET,
      callControlId: CALL_CONTROL_ID,
      text: "Hallo",
      model: "gpt-4o-mini",
    });
    const res = await fetch(req.url, req.init);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.ok(
      completionSpeech(body, res.headers.get("content-type")).includes(AGENT_SPEECH),
      `Body muss agentTurn-Text enthalten:\n${body}`,
    );
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test("AL-P8-27 Choreografie: call.answered -> speak traegt den Offenlegungssatz des SERVERS; ai_assistant_start erst nach speak.ended", async () => {
  const fake = await startTelnyxFake();
  const callId = "call_choreo";
  const srv = await startServer({
    env: shimEnv({ TELNYX_API_BASE: fake.url }),
    seed: seedState({
      calls: [
        seedCall({
          id: callId,
          callControlId: CALL_CONTROL_ID,
          assistantId: TELNYX_ASSISTANT_BOOT_ENV.TELNYX_ASSISTANT_ID,
          provider: "telnyx",
          status: "active",
          direction: "outbound",
          goal: "Testanliegen",
        }),
      ],
    }),
  });
  try {
    await postCallControlEvent(srv, callId, { eventType: "call.answered", callControlId: CALL_CONTROL_ID });
    const speakAction = await fake.waitForAction({ callControlId: CALL_CONTROL_ID, action: "speak" });
    const expected = expectedDisclosure(`${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`, "de");
    assert.ok(
      speakAction.body.payload.startsWith(expected),
      `speak-Payload muss mit der Offenlegung beginnen: "${speakAction.body.payload}"`,
    );

    // Regel 2: ai_assistant_start darf hier noch NICHT abgesetzt sein - der Server hat
    // bislang NUR call.answered gesehen, kein speak.ended.
    assert.equal(
      fake.actions.some((a) => a.action === "ai_assistant_start"),
      false,
      "ai_assistant_start VOR speak.ended waere ein Regel-2-Verstoss",
    );

    await postCallControlEvent(srv, callId, {
      eventType: "call.speak.ended",
      callControlId: CALL_CONTROL_ID,
      status: "completed",
    });
    await fake.waitForAction({ callControlId: CALL_CONTROL_ID, action: "ai_assistant_start" });
  } finally {
    await srv.stop();
    await fake.close();
  }
});

test("AL-P8-28 call.hangup schliesst den Call ab (status endet, Settlement gelaufen)", async () => {
  const fake = await startTelnyxFake();
  const callId = "call_choreo_hangup";
  const answeredAt = new Date(Date.now() - 30_000).toISOString();
  const srv = await startServer({
    env: shimEnv({ TELNYX_API_BASE: fake.url }),
    seed: seedState({
      calls: [
        seedCall({
          id: callId,
          callControlId: CALL_CONTROL_ID,
          assistantId: TELNYX_ASSISTANT_BOOT_ENV.TELNYX_ASSISTANT_ID,
          provider: "telnyx",
          status: "active",
          direction: "outbound",
          answeredAt,
          maxDurationS: 3600,
          reserveCents: 50,
          reserveReleased: false,
        }),
      ],
    }),
  });
  try {
    const res = await postCallControlEvent(srv, callId, { eventType: "call.hangup", callControlId: CALL_CONTROL_ID });
    assert.equal(res.status, 200);
    const state = await waitForStoreState(
      srv,
      (s) => Boolean(s.calls[0].billedAt) && s.calls[0].reserveReleased === true,
    );
    assert.equal(state.calls[0].status, "completed");
  } finally {
    await srv.stop();
    await fake.close();
  }
});

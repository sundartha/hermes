// Spawn/Wiring-Tests fuer POST /voice/call-control (PLAN-TELNYX-AI-ASSISTANT.md, P4.5):
// deckt Checks 2/3 REAL (nicht offline) ab - der Ed25519-Guard (app.use("/voice")) und
// die echte Settlement-Idempotenz (finishCall/billedAt/reserveReleased) laufen als
// Kindprozess. Muster fuer Signatur-fail-closed vgl. inbound-routing.test.js:171
// (Anti-Spoof-Test). json-Backend (Default), kein pglite-Mix (Lehre p6a).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForStoreState } from "./helpers.js";

function hangupBody(callControlId) {
  return { data: { event_type: "call.hangup", payload: { call_control_id: callControlId } } };
}

async function postCallControl(srv, headers, body) {
  return fetch(`${srv.localUrl}/voice/call-control?callId=call_test1`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("Signatur fail-closed: fehlender/bogus Telnyx-Ed25519-Header -> 403, KEINE Zustandsaenderung", async () => {
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false" },
    seed: seedState({ calls: [seedCall({ status: "active" })] }),
  });
  try {
    // a) kein Signatur-Header ueberhaupt
    const res1 = await postCallControl(srv, {}, hangupBody("cc_1"));
    assert.equal(res1.status, 403);
    assert.equal(srv.readStore().calls[0].status, "active");

    // b) erkannter Telnyx-Header, aber ungueltige Signatur
    const res2 = await postCallControl(
      srv,
      {
        "telnyx-signature-ed25519": "bogus-signature",
        "telnyx-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      hangupBody("cc_1"),
    );
    assert.equal(res2.status, 403);
    assert.equal(srv.readStore().calls[0].status, "active", "kein finishCall/state-change vor gueltiger Signatur");
  } finally {
    await srv.stop();
  }
});

test("call.hangup: Settlement idempotent - billedAt + reserveReleased gesetzt, zweites hangup bucht NICHT doppelt", async () => {
  const answeredAt = new Date(Date.now() - 90_000).toISOString();
  const srv = await startServer({
    seed: seedState({
      // maxDurationS grosszuegig ueber answeredAt hinaus: sonst klassifiziert das Boot-Re-Arm
      // (F10, server.js:rearmActiveCallTimers) den Call VOR unserem hangup-POST als Zombie
      // (status="failed") - das waere ein Test-Artefakt, keine Aussage ueber P4.5.
      calls: [
        seedCall({
          status: "active",
          answeredAt,
          maxDurationS: 3600,
          reserveCents: 50,
          reserveReleased: false,
        }),
      ],
    }),
  });
  try {
    const res1 = await postCallControl(srv, {}, hangupBody("cc_1"));
    assert.equal(res1.status, 200);

    const state1 = await waitForStoreState(srv, (s) => Boolean(s.calls[0].billedAt));
    assert.equal(state1.calls[0].status, "completed");
    assert.ok(state1.calls[0].billedAt);
    assert.equal(state1.calls[0].reserveReleased, true);
    const firstBilledAt = state1.calls[0].billedAt;

    const res2 = await postCallControl(srv, {}, hangupBody("cc_1"));
    assert.equal(res2.status, 200);
    // Kurze Gnadenfrist: ein etwaiger zweiter async-Buchungseffekt haette hier Zeit.
    await new Promise((r) => setTimeout(r, 200));
    const state2 = srv.readStore();
    assert.equal(state2.calls[0].billedAt, firstBilledAt, "keine Doppelbuchung bei zweitem hangup");
  } finally {
    await srv.stop();
  }
});

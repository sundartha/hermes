import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, waitForStoreState } from "./helpers.js";

const MAX_DURATION_S = 1;
const POLL_TIMEOUT_MS = MAX_DURATION_S * 1000 + 3000;
const DOMESTIC_TO = "+4915112345678";

async function placeCappedCall() {
  const srv = await startServer({ env: { FAKE_ORIGINATE: "true" } });
  const res = await fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: DOMESTIC_TO,
      objective: "Test",
      max_duration_s: String(MAX_DURATION_S),
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const s = await waitForStoreState(
    srv,
    (st) => st.calls.find((c) => c.id === body.callId)?.billedAt,
    POLL_TIMEOUT_MS,
  );
  return { srv, body, call: s.calls.find((c) => c.id === body.callId) };
}

test(
  "Live-Cap: laufender Call erreicht die Max-Dauer waehrend des normalen Betriebs " +
    "(kein Boot-Rearm) -> completed + providerCallSid + genau einmal gebucht",
  async () => {
    const { srv, body, call } = await placeCappedCall();
    try {
      assert.ok(
        body.twilioSid?.startsWith("fake_"),
        "providerCallSid kommt vom FAKE_ORIGINATE-Seam (netzfrei)",
      );
      assert.equal(
        call.status,
        "completed",
        "Live-Cap terminalisiert als completed (NICHT failed wie der Boot-Zombie)",
      );
      assert.ok(call.endedAt, "endedAt gesetzt");
      assert.equal(
        call.twilioSid,
        body.twilioSid,
        "providerCallSid bleibt bis zur Terminalisierung erhalten (an endCall durchgereicht)",
      );
      assert.ok(
        !/\[rearm\]/.test(srv.stdout),
        "Terminalisierung lief ueber den LIVE-Timer, nicht ueber rearmActiveCallTimers (kein Boot-Rearm-Log)",
      );
    } finally {
      await srv.stop();
    }
  },
);

const CAP_FAILURE_MARKER = /cap|max_duration/;
test("GAP-26 (SOLL, rot) - ein am Dauer-Cap terminalisierter Anruf traegt ein maschinenlesbares Cap-Merkmal", async () => {
  const { srv, call } = await placeCappedCall();
  try {
    assert.ok(call.failureReason, "am Cap gestorbener Anruf ist heute nicht von einem erfolgreichen unterscheidbar");
    assert.match(call.failureReason, CAP_FAILURE_MARKER);
  } finally {
    await srv.stop();
  }
});

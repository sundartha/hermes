// OUT-05 (F2): Erfolgs-Freigabe der Reserve ueber finishCall. #1 haelt eine Reserve, die den
// Cap fuer #2 reisst (402). Erst NACHDEM #1 ueber /voice/status als completed gemeldet wird
// (finishCall laeuft, releaseReserve gibt die Reserve frei), passiert die Wiederholung von #2.
// waitForLog wartet auf die [voice/status]-Logzeile (steht im Handler VOR dem fire-and-forget
// finishCall) - das drained die Server-Microtask-Queue ausreichend, bevor der naechste Request
// rausgeht (Muster wie outbound-reconcile-finishcall.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, waitForLog } from "./helpers.js";

const post = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });

test("OUT-05 F2: Erfolgs-Freigabe ueber finishCall gibt die Reserve frei", async () => {
  const srv = await startServer({
    env: {
      // LCT P6: MAX_BUDGET_EUR muss echt ueber der abgeleiteten Business-Plan-Decke
      // (900 ct) liegen, sonst verweigert der Boot-Guard (plan_cap_inert). Reserve pro
      // Call: 200 ct/min x ceil(180/60)=3 min = 600 ct; zwei Reserven (1200 ct) reissen
      // den 1000-ct-Cap, eine einzelne (600 ct) nicht.
      MAX_BUDGET_EUR: "10",
      VOICE_TARIFF_DOMESTIC_CENTS: "200",
      ALLOWED_COUNTRY_CODES: "*",
      FAKE_ORIGINATE: "true",
    },
  });
  try {
    const r1 = await post(srv.localUrl, "+4915112340001");
    assert.equal(r1.status, 200);
    const callId1 = (await r1.json()).callId;

    const r2 = await post(srv.localUrl, "+4915112340002");
    assert.equal(r2.status, 402, "zweite Reserve reisst den Cap, solange #1 haelt");

    const st = await fetch(`${srv.localUrl}/voice/status?callId=${callId1}`, {
      method: "POST",
      body: new URLSearchParams({ CallStatus: "completed" }),
    });
    assert.equal(st.status, 200);
    await waitForLog(srv, new RegExp(`\\[voice/status\\][^\\n]*"callId":"${callId1}"`));

    const r2b = await post(srv.localUrl, "+4915112340002");
    assert.equal(r2b.status, 200, "nach Freigabe von #1 ist die zweite Reserve wieder moeglich");
  } finally {
    await srv.stop();
  }
});

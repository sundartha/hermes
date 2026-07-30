// OUT-05 (F2): Erfolgs-Freigabe der Reserve ueber finishCall. #1 haelt eine Reserve, die den
// Cap fuer #2 reisst (402). Erst NACHDEM #1 ueber /voice/status als completed gemeldet wird
// (finishCall laeuft, releaseReserve gibt die Reserve frei), passiert die Wiederholung von #2.
// waitForLog wartet auf die [voice/status]-Logzeile (steht im Handler VOR dem fire-and-forget
// finishCall) - das drained die Server-Microtask-Queue ausreichend, bevor der naechste Request
// rausgeht (Muster wie outbound-reconcile-finishcall.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, waitForLog, DOMESTIC_TEST_NUMBER } from "./helpers.js";

const post = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });

test("OUT-05 F2: Erfolgs-Freigabe ueber finishCall gibt die Reserve frei", async () => {
  // Absender-DID mit +49, damit VOICE_TARIFF_DOMESTIC_CENTS die +49-Ziele ueberhaupt
  // tarifiert (P5: Inlandssatz nur bei gleicher Vorwahl an beiden Enden).
  const srv = await startServer({
    ownerNumber: DOMESTIC_TEST_NUMBER,
    env: {
      // MAX_BUDGET_EUR wirkt hier als Pro-Tenant-Fallback (effectiveCapCents Stufe 3 - der
      // Owner hat keine tenant_budget-Zeile). KS-P3 (a): die Reserve ist Satz x
      // RESERVE_LEAD_MINUTES (2), nicht mehr Satz x angefangene Minuten der Maximaldauer.
      // Reserve pro Call: 300 ct/min x 2 = 600 ct; zwei Reserven (1200 ct) reissen
      // den 1000-ct-Cap, eine einzelne (600 ct) nicht.
      MAX_BUDGET_EUR: "10",
      VOICE_TARIFF_DOMESTIC_CENTS: "300",
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

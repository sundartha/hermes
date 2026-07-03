// OUT-05 (F2): Reserve-Release-Backstop - Freigabe UNABHAENGIG vom Provider-completed-Callback.
// #1 laeuft mit max_duration_s=1 und bekommt NIE ein /voice/status (der fakeVoice-endCall ist
// ein No-op, finishCall laeuft also nicht). Die Reserve haelt den Cap fuer #2 (402), bis der
// Backstop-Timer (maxDur + RESERVE_RELEASE_GRACE_MS) feuert und sie eigenstaendig freigibt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const MAX_DURATION_S = 1;
const GRACE_MS = 200;
const TEST_SAFETY_MARGIN_MS = 200; // Puffer ueber dem exakten Timer-Delay (Jitter-Toleranz)
const BACKSTOP_WAIT_MS = MAX_DURATION_S * 1000 + GRACE_MS + TEST_SAFETY_MARGIN_MS;

test("OUT-05 F2: Reserve-Release-Backstop gibt die Reserve OHNE Provider-Callback frei", async () => {
  // Reserve pro Call: 60 ct/min x ceil(1/60)=1 min = 60 ct; zwei Reserven (120 ct) reissen
  // den 100-ct-Cap (MAX_BUDGET_EUR=1), eine einzelne nicht.
  const srv = await startServer({
    env: {
      MAX_BUDGET_EUR: "1",
      VOICE_TARIFF_DOMESTIC_CENTS: "60",
      RESERVE_RELEASE_GRACE_MS: String(GRACE_MS),
      ALLOWED_COUNTRY_CODES: "*",
      FAKE_ORIGINATE: "true",
    },
  });
  try {
    const post = (to) =>
      fetch(`${srv.localUrl}/api/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, objective: "Test", max_duration_s: String(MAX_DURATION_S) }),
      });
    assert.equal((await post("+4915112340001")).status, 200);
    assert.equal((await post("+4915112340002")).status, 402);
    // Bewusster Timer-Test: KEIN /voice/status - isoliert den Backstop-Pfad von finishCall.
    await new Promise((r) => setTimeout(r, BACKSTOP_WAIT_MS));
    assert.equal(
      (await post("+4915112340002")).status,
      200,
      "Backstop-Timer hat die Reserve freigegeben",
    );
  } finally {
    await srv.stop();
  }
});

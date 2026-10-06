import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, DOMESTIC_TEST_NUMBER } from "./helpers.js";

const MAX_DURATION_S = 1;
const GRACE_MS = 200;
const TEST_SAFETY_MARGIN_MS = 200;
const BACKSTOP_WAIT_MS = MAX_DURATION_S * 1000 + GRACE_MS + TEST_SAFETY_MARGIN_MS;

test("OUT-05 F2: Reserve-Release-Backstop gibt die Reserve OHNE Provider-Callback frei", async () => {
  const srv = await startServer({
    ownerNumber: DOMESTIC_TEST_NUMBER,
    env: {
      MAX_BUDGET_EUR: "10",
      VOICE_TARIFF_DOMESTIC_CENTS: "300",
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

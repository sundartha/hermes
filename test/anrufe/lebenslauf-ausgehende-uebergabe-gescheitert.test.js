import { test } from "node:test";
import assert from "node:assert/strict";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { seedCall, seedState, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const CALL_ID = "call_lebenslauf_gescheitert";

test("LEBENSLAUF-GESCHEITERT-1: scheitert die ausgehende EL-Uebergabe, legt die Route auf statt eine Uebergabe zu senden", async () => {
  const call = seedCall({
    id: CALL_ID,
    provider: "telnyx",
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    streamToken: "a".repeat(32),
  });
  const srv = await startServer({ env: {}, seed: seedState({ calls: [call] }) });
  try {
    const antwort = await abrufMitFrist(`${srv.localUrl}/voice/outbound?callId=${CALL_ID}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallSid: "v3:lebenslauf" }).toString(),
    });
    assert.equal(antwort.status, HTTP_OK);
    const xml = await antwort.text();
    assert.ok(xml.includes("<Hangup"), xml);
    assert.ok(!xml.includes("<Dial"), xml);
  } finally {
    await srv.stop();
  }
});

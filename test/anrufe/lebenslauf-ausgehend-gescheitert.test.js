import { test } from "node:test";
import assert from "node:assert/strict";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const FRIST_MS = 15000;
const HTTP_OK = 200;
const ID = "call_lebenslauf_ausgehend";

test("LEBENSLAUF-11: scheitert die ausgehende EL-Uebergabe, steht der Anruf auf failed und die Antwort legt auf", async () => {
  const call = seedCall({ id: ID, provider: "telnyx", costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI });
  const srv = await startServer({ seed: seedState({ calls: [call] }) });
  try {
    const antwort = await abrufMitFrist(`${srv.localUrl}/voice/outbound?callId=${ID}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallSid: "v3:lebenslauf" }).toString(),
    });
    const xml = await antwort.text();
    assert.equal(antwort.status, HTTP_OK, xml);
    assert.ok(xml.includes("<Hangup"), xml);
    const stand = await waitForStoreState(srv, (s) => s.calls.find((c) => c.id === ID)?.status === "failed", FRIST_MS);
    assert.equal(stand.calls.find((c) => c.id === ID).status, "failed");
  } finally {
    await srv.stop();
  }
});

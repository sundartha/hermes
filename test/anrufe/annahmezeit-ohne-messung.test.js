import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { TELNYX_TEST_SIGNATURE_HEADERS, seedCall, seedState, seedWithTelnyxNumber, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const MS_JE_S = 1000;
const WARTE_FRIST_MS = 8000;
const vorSekunden = (s) => new Date(Date.now() - s * MS_JE_S).toISOString();

test("annahmezeit-ohne-messung: ein angenommener Anruf endet ohne Messfehler, wenn die Betriebsmessung nicht scharf ist", async () => {
  const call = seedCall({
    id: "call_still",
    direction: "outbound",
    twilioSid: "CAcall_still",
    from: "+4915255555555",
    to: "+4915112345678",
    startedAt: vorSekunden(100),
    answeredAt: vorSekunden(90),
    maxDurationS: 600,
  });
  const srv = await startServer({
    seed: seedState({ ...seedWithTelnyxNumber({ language: "de" }), calls: [call] }),
    env: {
      ALLOWED_COUNTRY_CODES: "+49",
      FAKE_ORIGINATE: "true",
      ELEVENLABS_OUTBOUND_ENABLED: "false",
      PRECALL_BRIEFING_ENABLED: "false",
    },
  });
  try {
    const antwort = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=call_still`, {
      method: "POST",
      headers: TELNYX_TEST_SIGNATURE_HEADERS,
      body: new URLSearchParams({ CallSid: "CAcall_still", CallStatus: "completed" }),
    });
    assert.equal(antwort.status, 200);
    const frist = AbortSignal.timeout(WARTE_FRIST_MS);
    while (!srv.stdout.includes("[voice/status]")) {
      assert.ok(!frist.aborted, "Statusmeldung nicht verarbeitet");
      await setImmediate();
    }
    await abrufMitFrist(`${srv.localUrl}/healthz`);
    assert.ok(!srv.stdout.includes("[betriebsmessung]"), srv.stdout);
  } finally {
    await srv.stop();
  }
});

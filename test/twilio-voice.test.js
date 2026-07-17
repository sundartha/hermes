// S1-16: twilioVoice.originateCall/endCall gegen den ECHTEN Adapter, ueber den
// test-only SDK-Factory-Seam (src/telephony/adapters/twilio/client.js). Kein Env-/
// Config-Toggle - der Seam ist nur ueber __setTwilioSdkFactoryForTest erreichbar und
// wird im finally IMMER zurueckgesetzt (kein Fehl-Anruf/Kosten-Leak-Risiko: das echte
// Twilio-SDK wird hier nie getroffen).
import { test } from "node:test";
import assert from "node:assert/strict";
import { twilioVoice } from "../src/telephony/adapters/twilio/voice.js";
import { __setTwilioSdkFactoryForTest } from "../src/telephony/adapters/twilio/client.js";

// Fake-SDK: calls ist Funktion (fuer calls(sid).update) UND traegt .create (fuer
// calls.create) - twilioVoice nutzt beide Formen.
function makeFakeSdk(rec) {
  const calls = (sid) => {
    rec.updateSid = sid;
    return {
      update: async (args) => {
        rec.updateArgs = args;
      },
    };
  };
  calls.create = async (params) => {
    rec.createArgs = params;
    return { sid: "CAfake123" };
  };
  return () => ({ calls });
}

test("S1-16a: originateCall reicht die Params 1:1 durch + mappt tw.sid -> {sid}", async () => {
  const rec = {};
  const restore = __setTwilioSdkFactoryForTest(makeFakeSdk(rec));
  try {
    const params = { to: "+4915100000001", from: "+4915199999999", url: "https://agent.test/voice" };
    const out = await twilioVoice.originateCall(params);
    assert.deepEqual(out, { sid: "CAfake123" });
    assert.deepEqual(rec.createArgs, params);
  } finally {
    restore();
  }
});

test("S1-16b: endCall aktualisiert den Call auf status=completed", async () => {
  const rec = {};
  const restore = __setTwilioSdkFactoryForTest(makeFakeSdk(rec));
  try {
    await twilioVoice.endCall("CAxyz");
    assert.equal(rec.updateSid, "CAxyz");
    assert.deepEqual(rec.updateArgs, { status: "completed" });
  } finally {
    restore();
  }
});

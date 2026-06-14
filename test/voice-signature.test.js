// P2-Regression: Inbound-Signaturpruefung als Port (verifyInboundSignature).
// Deckt das NEUE pruefbare Verhalten ab, das security.test.js nicht hat:
// fail-closed bei fehlender PUBLIC_URL. Selbst MIT Signatur-Header darf der
// /voice-Webhook ohne rekonstruierbare signierte URL nie 200 liefern (-> 403).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, BASE_ENV } from "./helpers.js";

test("/voice fail-closed ohne PUBLIC_URL trotz Signatur-Header", async () => {
  // Echte Pruefung an (skip=false) UND publicUrl leer -> verifyInboundSignature == false
  const srv = await startServer({ env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", PUBLIC_URL: "" } });
  try {
    const params = { CallSid: "CAtest", From: "+4915112345678", To: BASE_ENV.TWILIO_NUMBER };
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      headers: { "X-Twilio-Signature": "irgendwas" },
      body: new URLSearchParams(params),
    });
    assert.equal(res.status, 403);
  } finally {
    await srv.stop();
  }
});

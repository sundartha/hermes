import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer } from "../helpers.js";

const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const SIGNATURZEILE = "[voice-signature]";

test("voice.js: GET /voice/tts/:token wird VOR der /voice-Signatur-MW registriert (INV-4)", async () => {
  const srv = await startServer({ env: { SKIP_TWILIO_SIGNATURE_CHECK: "false" } });
  try {
    const abruf = await fetch(`${srv.localUrl}/voice/tts/unbekanntes-token`);
    assert.equal(abruf.status, HTTP_NOT_FOUND, "der Audio-Abruf braucht keine Anbieter-Signatur");
    assert.ok(
      !srv.stdout.includes(SIGNATURZEILE),
      `TTS-Abruf lief durch die Signaturprüfung:\n${srv.stdout}`,
    );

    const webhook = await fetch(`${srv.localUrl}/voice/status`, { method: "POST" });
    assert.equal(webhook.status, HTTP_FORBIDDEN, "Webhooks unter /voice bleiben signaturpflichtig");
  } finally {
    await srv.stop();
  }
});

// P2-Regression: Inbound-Signaturpruefung als Port (verifyInboundSignature).
// Deckt das fail-closed-Verhalten ab, das security.test.js nicht hat: ohne
// rekonstruierbare PUBLIC_URL gilt KEINE Signatur als gueltig - selbst mit
// gesetztem Signatur-Header.
//
// Frueher ein Spawn-Test mit leerer PUBLIC_URL. Seit OT-4 verweigert der Boot bei
// leerer Pflicht-Config (PUBLIC_URL) den Start (fail-closed) -> ein laufender
// Server mit leerer PUBLIC_URL ist nicht mehr herstellbar. Der verbleibende,
// pruefbare Kern (`if (!config.server.publicUrl) return false`) wird hier als Unit gegen
// den Port festgenagelt: offline, ohne Spawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { verifyInboundSignature } from "../src/telephony/adapters/twilio/signature.js";

test("verifyInboundSignature fail-closed ohne PUBLIC_URL (selbst mit Signatur-Header)", () => {
  const saved = config.server.publicUrl;
  config.server.publicUrl = "";
  try {
    const ok = verifyInboundSignature({
      headers: { "x-twilio-signature": "irgendwas" },
      url: "https://agent.test/voice/incoming",
      params: { CallSid: "CAtest", From: "+4915112345678", To: "+15005550006" },
    });
    assert.equal(ok, false, "ohne publicUrl darf keine Signatur als gueltig gelten");
  } finally {
    config.server.publicUrl = saved;
  }
});

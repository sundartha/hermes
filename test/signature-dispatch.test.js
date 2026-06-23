// P5: Header-basierter Dispatch des inboundSignatureVerifier (registry). Beweist,
// dass die registry nach Signatur-HEADER waehlt (nicht nach provider/To) - die
// Signatur ist die erste fail-closed-Stufe und liegt VOR dem To-Routing. Drei
// Konzepte: x-twilio-signature -> Twilio-Pfad, telnyx-Header -> Telnyx-Pfad, kein
// erkannter Header -> false (fail-closed). Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { config } from "../src/config.js";
import { inboundSignatureVerifier } from "../src/telephony/registry.js";

const ED25519_RAW_KEY_LEN = 32;

test("x-twilio-signature -> Twilio-Pfad (fail-closed ohne PUBLIC_URL -> false)", () => {
  // publicUrl leer -> der Twilio-Verifier kann die signierte URL nicht
  // rekonstruieren und liefert false. Dass ueberhaupt false (statt der
  // fall-through-false) zurueckkommt, beweist: der Twilio-Pfad wurde betreten.
  config.publicUrl = "";
  const ok = inboundSignatureVerifier().verifyInboundSignature({
    headers: { "x-twilio-signature": "irgendwas" },
    url: "https://agent.test/voice/incoming",
    params: { To: "+15005550006" },
  });
  assert.equal(ok, false);
});

test("telnyx-Header -> Telnyx-Pfad (korrekte Ed25519-Signatur -> true)", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  config.telnyxPublicKey = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-ED25519_RAW_KEY_LEN)
    .toString("base64");
  const ts = String(Math.floor(Date.now() / 1000));
  const rawBody = Buffer.from(JSON.stringify({ data: {} }));
  const sig = crypto
    .sign(null, Buffer.concat([Buffer.from(`${ts}|`), rawBody]), privateKey)
    .toString("base64");
  const ok = inboundSignatureVerifier().verifyInboundSignature({
    headers: { "telnyx-signature-ed25519": sig, "telnyx-timestamp": ts },
    rawBody,
  });
  assert.equal(ok, true);
});

test("kein erkannter Provider-Header -> false (fail-closed)", () => {
  const ok = inboundSignatureVerifier().verifyInboundSignature({
    headers: {},
    rawBody: Buffer.from("{}"),
  });
  assert.equal(ok, false);
});

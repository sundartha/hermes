// P5: Header-basierter Dispatch des inboundSignatureVerifier (registry). Beweist,
// dass die registry nach Signatur-HEADER waehlt (nicht nach provider/To) - die
// Signatur ist die erste fail-closed-Stufe und liegt VOR dem To-Routing. Zwei
// Konzepte: telnyx-Header -> Telnyx-Pfad, alles andere (auch ein Twilio-Header) ->
// false (fail-closed). Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { inboundSignatureVerifier } from "../src/telephony/registry.js";
import { makeTelnyxSigner, nowSeconds } from "./helpers.js";

test("telnyx-Header -> Telnyx-Pfad (korrekte Ed25519-Signatur -> true)", () => {
  const signer = makeTelnyxSigner();
  config.telephony.telnyxPublicKey = signer.publicKeyBase64;
  const ts = String(nowSeconds());
  const rawBody = Buffer.from(JSON.stringify({ data: {} }));
  const ok = inboundSignatureVerifier().verifyInboundSignature({
    headers: { "telnyx-signature-ed25519": signer.sign(ts, rawBody), "telnyx-timestamp": ts },
    rawBody,
  });
  assert.equal(ok, true);
});

test("kein erkannter Provider-Header -> false (fail-closed)", () => {
  const verify = (headers) =>
    inboundSignatureVerifier().verifyInboundSignature({ headers, rawBody: Buffer.from("{}") });
  assert.equal(verify({}), false);
  // C-P3: x-twilio-signature gehoert seit dem Wegfall des Twilio-Zweigs zu "unbekannt".
  // Der frueher hier stehende Twilio-Pfad-Test waere sonst still zur Tautologie geworden:
  // sein erwartetes false kaeme jetzt aus genau diesem fall-through.
  assert.equal(verify({ "x-twilio-signature": "irgendwas" }), false);
});

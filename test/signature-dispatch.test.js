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
  assert.equal(verify({ "x-twilio-signature": "irgendwas" }), false);
});

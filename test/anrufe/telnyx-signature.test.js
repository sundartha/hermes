import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../../src/config.ts";
import { verifyInboundSignature } from "../../src/telephony/adapters/telnyx/signature.ts";
import { makeTelnyxSigner, nowSeconds } from "../helpers.js";

const REPLAY_WINDOW_S = 300;

test("korrekt signierter Webhook (base64-raw-32-Byte-Key) -> true", () => {
  const signer = makeTelnyxSigner();
  config.telephony.telnyxPublicKey = signer.publicKeyBase64;
  const ts = String(nowSeconds());
  const rawBody = Buffer.from(JSON.stringify({ data: { event_type: "message.received" } }));
  assert.equal(
    verifyInboundSignature({
      headers: { "telnyx-signature-ed25519": signer.sign(ts, rawBody), "telnyx-timestamp": ts },
      rawBody,
    }),
    true,
  );
});

test("korrekt signierter Webhook (PEM-Key) -> true", () => {
  const signer = makeTelnyxSigner();
  config.telephony.telnyxPublicKey = signer.publicKeyPem;
  const ts = String(nowSeconds());
  const rawBody = Buffer.from("{}");
  assert.equal(
    verifyInboundSignature({
      headers: { "telnyx-signature-ed25519": signer.sign(ts, rawBody), "telnyx-timestamp": ts },
      rawBody,
    }),
    true,
  );
});

test("manipulierter Body -> false", () => {
  const signer = makeTelnyxSigner();
  config.telephony.telnyxPublicKey = signer.publicKeyBase64;
  const ts = String(nowSeconds());
  const sig = signer.sign(ts, Buffer.from("original"));
  assert.equal(
    verifyInboundSignature({
      headers: { "telnyx-signature-ed25519": sig, "telnyx-timestamp": ts },
      rawBody: Buffer.from("manipuliert"),
    }),
    false,
  );
});

test("abgelaufener Timestamp (> Replay-Window) -> false", () => {
  const signer = makeTelnyxSigner();
  config.telephony.telnyxPublicKey = signer.publicKeyBase64;
  const ts = String(nowSeconds() - REPLAY_WINDOW_S - 60);
  const rawBody = Buffer.from("{}");
  assert.equal(
    verifyInboundSignature({
      headers: { "telnyx-signature-ed25519": signer.sign(ts, rawBody), "telnyx-timestamp": ts },
      rawBody,
    }),
    false,
  );
});

test("fehlender Signatur-Header -> false", () => {
  const signer = makeTelnyxSigner();
  config.telephony.telnyxPublicKey = signer.publicKeyBase64;
  const ts = String(nowSeconds());
  assert.equal(
    verifyInboundSignature({ headers: { "telnyx-timestamp": ts }, rawBody: Buffer.from("{}") }),
    false,
  );
});

test("fehlender Public-Key (Config leer) -> false (fail-closed)", () => {
  const signer = makeTelnyxSigner();
  config.telephony.telnyxPublicKey = "";
  const ts = String(nowSeconds());
  const rawBody = Buffer.from("{}");
  assert.equal(
    verifyInboundSignature({
      headers: { "telnyx-signature-ed25519": signer.sign(ts, rawBody), "telnyx-timestamp": ts },
      rawBody,
    }),
    false,
  );
});

function mitTelephony(werte, lauf) {
  const alt = { ...config.telephony };
  Object.assign(config.telephony, werte);
  try {
    return lauf();
  } finally {
    Object.assign(config.telephony, alt);
  }
}

test("3400-telnyx: Signaturpruefung nimmt nur gueltige Signaturen und lehnt alles andere ab", () => {
  const signer = makeTelnyxSigner();
  const rawBody = Buffer.from('{"data":{}}');
  const ts = String(nowSeconds());
  const kopf = (sig, zeit = ts) => ({ "telnyx-signature-ed25519": sig, "telnyx-timestamp": zeit });
  mitTelephony({ telnyxPublicKey: signer.publicKeyBase64 }, () => {
    assert.equal(verifyInboundSignature({ headers: kopf(signer.sign(ts, rawBody)), rawBody }), true);
    assert.equal(verifyInboundSignature({ headers: kopf(signer.sign(ts, Buffer.from("x"))), rawBody }), false);
    assert.equal(verifyInboundSignature({ headers: kopf(""), rawBody }), false);
    assert.equal(verifyInboundSignature({ headers: {}, rawBody }), false);
    assert.equal(verifyInboundSignature({ headers: kopf(signer.sign(ts, rawBody)), rawBody: undefined }), false);
    assert.equal(verifyInboundSignature({ headers: kopf(signer.sign("abc", rawBody), "abc"), rawBody }), false);
  });
  mitTelephony({ telnyxPublicKey: signer.publicKeyPem }, () => {
    assert.equal(verifyInboundSignature({ headers: kopf(signer.sign(ts, rawBody)), rawBody }), true);
  });
  const andere = makeTelnyxSigner();
  mitTelephony({ telnyxPublicKey: andere.publicKeyBase64 }, () => {
    assert.equal(verifyInboundSignature({ headers: kopf(signer.sign(ts, rawBody)), rawBody }), false);
  });
});

test("3400-telnyx: ohne brauchbaren oeffentlichen Schluessel wird jede Signatur abgelehnt", () => {
  const signer = makeTelnyxSigner();
  const rawBody = Buffer.from("{}");
  const ts = String(nowSeconds());
  const headers = { "telnyx-signature-ed25519": signer.sign(ts, rawBody), "telnyx-timestamp": ts };
  const unbrauchbar = ["", undefined, null, 5, {}, "AAAA", "-----BEGIN kaputt"];
  for (const key of unbrauchbar) {
    mitTelephony({ telnyxPublicKey: key }, () => {
      assert.equal(verifyInboundSignature({ headers, rawBody }), false, String(key));
    });
  }
});

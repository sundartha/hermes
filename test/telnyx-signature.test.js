import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { config } from "../src/config.js";
import { verifyInboundSignature } from "../src/telephony/adapters/telnyx/signature.js";
import { makeTelnyxSigner, nowSeconds } from "./helpers.js";

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

test("Timestamp genau am Rand des Replay-Windows (300 s) -> true", (t) => {
  const FIXED_NOW_MS = 1_700_000_000_000;
  mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS });
  t.after(() => mock.timers.reset());
  const signer = makeTelnyxSigner();
  config.telephony.telnyxPublicKey = signer.publicKeyBase64;
  const ts = String(FIXED_NOW_MS / 1000 - REPLAY_WINDOW_S);
  const rawBody = Buffer.from("{}");
  assert.equal(
    verifyInboundSignature({
      headers: { "telnyx-signature-ed25519": signer.sign(ts, rawBody), "telnyx-timestamp": ts },
      rawBody,
    }),
    true,
  );
});

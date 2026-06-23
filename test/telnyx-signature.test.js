// P5: Telnyx-Ed25519-Verifikation, fail-closed-Paritaet zum Twilio-Verifier. In-Test
// generiertes Ed25519-Schluesselpaar; der Public-Key wird (als Telnyx-base64-raw-32-
// Byte UND als PEM) in config.telnyxPublicKey injiziert. Korrekt signierter
// `${ts}|${rawBody}` -> true; manipuliert/abgelaufen/fehlend/kein-Key -> false.
// Offline (node:crypto, kein Netz).
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { config } from "../src/config.js";
import { verifyInboundSignature } from "../src/telephony/adapters/telnyx/signature.js";

const ED25519_RAW_KEY_LEN = 32;
const REPLAY_WINDOW_S = 300;

function makeKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  // Telnyx liefert den Public-Key als base64-raw-32-Byte (letzte 32 Byte der SPKI-DER).
  const rawBase64 = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-ED25519_RAW_KEY_LEN)
    .toString("base64");
  const pem = publicKey.export({ format: "pem", type: "spki" }).toString();
  return { privateKey, rawBase64, pem };
}

function sign(privateKey, ts, rawBody) {
  return crypto
    .sign(null, Buffer.concat([Buffer.from(`${ts}|`), rawBody]), privateKey)
    .toString("base64");
}

const nowS = () => Math.floor(Date.now() / 1000);

test("korrekt signierter Webhook (base64-raw-32-Byte-Key) -> true", () => {
  const { privateKey, rawBase64 } = makeKeys();
  config.telnyxPublicKey = rawBase64;
  const ts = String(nowS());
  const rawBody = Buffer.from(JSON.stringify({ data: { event_type: "message.received" } }));
  const sig = sign(privateKey, ts, rawBody);
  assert.equal(
    verifyInboundSignature({
      headers: { "telnyx-signature-ed25519": sig, "telnyx-timestamp": ts },
      rawBody,
    }),
    true,
  );
});

test("korrekt signierter Webhook (PEM-Key) -> true", () => {
  const { privateKey, pem } = makeKeys();
  config.telnyxPublicKey = pem;
  const ts = String(nowS());
  const rawBody = Buffer.from("{}");
  const sig = sign(privateKey, ts, rawBody);
  assert.equal(
    verifyInboundSignature({
      headers: { "telnyx-signature-ed25519": sig, "telnyx-timestamp": ts },
      rawBody,
    }),
    true,
  );
});

test("manipulierter Body -> false", () => {
  const { privateKey, rawBase64 } = makeKeys();
  config.telnyxPublicKey = rawBase64;
  const ts = String(nowS());
  const sig = sign(privateKey, ts, Buffer.from("original"));
  assert.equal(
    verifyInboundSignature({
      headers: { "telnyx-signature-ed25519": sig, "telnyx-timestamp": ts },
      rawBody: Buffer.from("manipuliert"),
    }),
    false,
  );
});

test("abgelaufener Timestamp (> Replay-Window) -> false", () => {
  const { privateKey, rawBase64 } = makeKeys();
  config.telnyxPublicKey = rawBase64;
  const ts = String(nowS() - REPLAY_WINDOW_S - 60);
  const rawBody = Buffer.from("{}");
  const sig = sign(privateKey, ts, rawBody);
  assert.equal(
    verifyInboundSignature({
      headers: { "telnyx-signature-ed25519": sig, "telnyx-timestamp": ts },
      rawBody,
    }),
    false,
  );
});

test("fehlender Signatur-Header -> false", () => {
  const { rawBase64 } = makeKeys();
  config.telnyxPublicKey = rawBase64;
  const ts = String(nowS());
  assert.equal(
    verifyInboundSignature({ headers: { "telnyx-timestamp": ts }, rawBody: Buffer.from("{}") }),
    false,
  );
});

test("fehlender Public-Key (Config leer) -> false (fail-closed)", () => {
  const { privateKey } = makeKeys();
  config.telnyxPublicKey = "";
  const ts = String(nowS());
  const rawBody = Buffer.from("{}");
  const sig = sign(privateKey, ts, rawBody);
  assert.equal(
    verifyInboundSignature({
      headers: { "telnyx-signature-ed25519": sig, "telnyx-timestamp": ts },
      rawBody,
    }),
    false,
  );
});

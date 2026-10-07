import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer, waitForLog, makeTelnyxSigner, nowSeconds } from "../helpers.js";
import { config } from "../../src/config.js";
import { inboundSignatureVerifier } from "../../src/telephony/registry.js";

const HTTP_FORBIDDEN = 403;
const ERWARTETE_SIGNATURZEILEN = 3;

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

const BOGUS_TELNYX_SIG = "bogus-telnyx-ed25519-signature";
const BOGUS_TWILIO_SIG = "bogus-twilio-hmac-signature";
const BOGUS_TS = "1720700000";
const CALLER_E164 = "+4915112345678";

const post = (srv, path, headers) =>
  fetch(`${srv.localUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ From: CALLER_E164 }).toString(),
  });

test("OBS-3: ungueltige Inbound-Signatur -> 403 + PII-freie Logzeile mit Provider-Herkunft", async () => {
  const srv = await startServer({ env: { SKIP_TWILIO_SIGNATURE_CHECK: "false" } });
  try {
    const rTelnyx = await post(srv, "/voice/call-control?callId=x", {
      "telnyx-signature-ed25519": BOGUS_TELNYX_SIG,
      "telnyx-timestamp": BOGUS_TS,
    });
    assert.equal(rTelnyx.status, HTTP_FORBIDDEN);
    await waitForLog(
      srv,
      /\[voice-signature\][^\n]*path=\/voice\/call-control[^\n]*provider=telnyx/,
    );

    const rTwilio = await post(srv, "/voice/incoming", { "x-twilio-signature": BOGUS_TWILIO_SIG });
    assert.equal(rTwilio.status, HTTP_FORBIDDEN);
    await waitForLog(srv, /\[voice-signature\][^\n]*path=\/voice\/incoming[^\n]*provider=unknown/);

    const rUnknown = await post(srv, "/voice/status", {});
    assert.equal(rUnknown.status, HTTP_FORBIDDEN);
    await waitForLog(srv, /\[voice-signature\][^\n]*path=\/voice\/status[^\n]*provider=unknown/);

    const lines = srv.stdout.split("\n").filter((zeile) => zeile.includes("[voice-signature]"));
    assert.ok(
      lines.length >= ERWARTETE_SIGNATURZEILEN,
      `drei OBS-3-Zeilen erwartet:\n${srv.stdout}`,
    );
    for (const zeile of lines) {
      assert.ok(!zeile.includes(BOGUS_TELNYX_SIG), `Telnyx-Signatur-Wert im Log: ${zeile}`);
      assert.ok(!zeile.includes(BOGUS_TWILIO_SIG), `Twilio-Signatur-Wert im Log: ${zeile}`);
      assert.ok(!zeile.includes(BOGUS_TS), `Timestamp im Log: ${zeile}`);
      assert.ok(!zeile.includes(CALLER_E164), `E.164 im Log (PII): ${zeile}`);
      assert.ok(!/rawBody/i.test(zeile), `rawBody im Log: ${zeile}`);
    }
  } finally {
    await srv.stop();
  }
});

test("OBS-3: uebersprungene Signaturpruefung (skip=true) erzeugt KEINE [voice-signature]-Zeile", async () => {
  const srv = await startServer();
  try {
    const res = await post(srv, "/voice/status?callId=nope", {});
    assert.notEqual(res.status, HTTP_FORBIDDEN, "skip=true darf nicht am Signatur-Gate 403en");
    assert.ok(
      !srv.stdout.includes("[voice-signature]"),
      `keine OBS-3-Zeile bei uebersprungener Pruefung erwartet:\n${srv.stdout}`,
    );
  } finally {
    await srv.stop();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, waitForLog } from "./helpers.js";

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
    assert.equal(rTelnyx.status, 403);
    await waitForLog(srv, /\[voice-signature\][^\n]*path=\/voice\/call-control[^\n]*provider=telnyx/);

    const rTwilio = await post(srv, "/voice/incoming", { "x-twilio-signature": BOGUS_TWILIO_SIG });
    assert.equal(rTwilio.status, 403);
    await waitForLog(srv, /\[voice-signature\][^\n]*path=\/voice\/incoming[^\n]*provider=unknown/);

    const rUnknown = await post(srv, "/voice/status", {});
    assert.equal(rUnknown.status, 403);
    await waitForLog(srv, /\[voice-signature\][^\n]*path=\/voice\/status[^\n]*provider=unknown/);

    const lines = srv.stdout.split("\n").filter((l) => l.includes("[voice-signature]"));
    assert.ok(lines.length >= 3, `drei OBS-3-Zeilen erwartet:\n${srv.stdout}`);
    for (const l of lines) {
      assert.ok(!l.includes(BOGUS_TELNYX_SIG), `Telnyx-Signatur-Wert im Log: ${l}`);
      assert.ok(!l.includes(BOGUS_TWILIO_SIG), `Twilio-Signatur-Wert im Log: ${l}`);
      assert.ok(!l.includes(BOGUS_TS), `Timestamp im Log: ${l}`);
      assert.ok(!l.includes(CALLER_E164), `E.164 im Log (PII): ${l}`);
      assert.ok(!/rawBody/i.test(l), `rawBody im Log: ${l}`);
    }
  } finally {
    await srv.stop();
  }
});

test("OBS-3: uebersprungene Signaturpruefung (skip=true) erzeugt KEINE [voice-signature]-Zeile", async () => {
  const srv = await startServer();
  try {
    const res = await post(srv, "/voice/status?callId=nope", {});
    assert.notEqual(res.status, 403, "skip=true darf nicht am Signatur-Gate 403en");
    assert.ok(
      !srv.stdout.includes("[voice-signature]"),
      `keine OBS-3-Zeile bei uebersprungener Pruefung erwartet:\n${srv.stdout}`,
    );
  } finally {
    await srv.stop();
  }
});

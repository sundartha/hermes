// OBS-3: Ein fehlgeschlagener Provider-Signatur-Check (Twilio ODER Telnyx) an der
// app.use("/voice")-Middleware war bisher STUMM (nur 403) - gedrehte Keys, ein falsch
// signierender Client oder gestoerte Zustellung blieben in den Render-Logs unsichtbar
// (CLAUDE.md Regel 7). Pinnt: jeder !ok-403 hinterlaesst genau EINE Zeile mit Provider-
// HERKUNFT (twilio|telnyx|unknown) + query-freiem Pfad, PII-/secret-frei (nie Signatur-
// Wert, Timestamp, rawBody, E.164); eine uebersprungene Pruefung erzeugt KEINE Zeile.
// Spawn-basiert (helpers.startServer), offline: alle 403 fallen VOR jedem Handler.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, waitForLog } from "./helpers.js";

const BOGUS_TELNYX_SIG = "bogus-telnyx-ed25519-signature";
const BOGUS_TWILIO_SIG = "bogus-twilio-hmac-signature";
const BOGUS_TS = "1720700000"; // fester Unix-Sekunden-Stempel (Timestamp-Header)
const CALLER_E164 = "+4915112345678"; // darf NICHT im Log erscheinen (PII-Gate)

const post = (srv, path, headers) =>
  fetch(`${srv.localUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ From: CALLER_E164 }).toString(),
  });

test("OBS-3: ungueltige Inbound-Signatur -> 403 + PII-freie Logzeile mit Provider-Herkunft", async () => {
  const srv = await startServer({ env: { SKIP_TWILIO_SIGNATURE_CHECK: "false" } });
  try {
    // a) Telnyx-Header, bogus Signatur -> 403 + provider=telnyx
    const rTelnyx = await post(srv, "/voice/call-control?callId=x", {
      "telnyx-signature-ed25519": BOGUS_TELNYX_SIG,
      "telnyx-timestamp": BOGUS_TS,
    });
    assert.equal(rTelnyx.status, 403);
    await waitForLog(srv, /\[voice-signature\][^\n]*path=\/voice\/call-control[^\n]*provider=telnyx/);

    // b) Twilio-Header, bogus Signatur -> 403 + provider=twilio
    const rTwilio = await post(srv, "/voice/incoming", { "x-twilio-signature": BOGUS_TWILIO_SIG });
    assert.equal(rTwilio.status, 403);
    await waitForLog(srv, /\[voice-signature\][^\n]*path=\/voice\/incoming[^\n]*provider=twilio/);

    // c) kein erkennbarer Provider-Header -> 403 + provider=unknown
    const rUnknown = await post(srv, "/voice/status", {});
    assert.equal(rUnknown.status, 403);
    await waitForLog(srv, /\[voice-signature\][^\n]*path=\/voice\/status[^\n]*provider=unknown/);

    // d) PII-/Secret-Gate: keine OBS-3-Zeile traegt Signatur-Wert, Timestamp, rawBody oder E.164
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
  const srv = await startServer(); // Default-Env: SKIP_TWILIO_SIGNATURE_CHECK=true
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

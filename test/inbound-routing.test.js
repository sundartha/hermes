// P3c: fail-closed Inbound-To-Routing. Eine unbekannte/fehlende To wird auf KEINEN
// Tenant aufgeloest (kein Default-Tenant) -> hoeflicher Hangup + Audit, KEIN
// Call-Record. Nur die geseedete Owner-Store-Nummer (OWNER_TEST_NUMBER) routet. Die
// Twilio-Signatur wird VOR To geprueft (Anti-Spoof) - eine gespoofte To ohne
// gueltige Signatur erreicht das Routing nie (403). Build-Operate-Check je Konzept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, waitForLog, OWNER_TEST_NUMBER } from "./helpers.js";

const UNKNOWN_TO = "+49999999999"; // nicht geseedet -> nicht routbar

test("unbekannte To -> fail-closed Hangup + Audit, kein Stream, kein Call-Record", async () => {
  const srv = await startServer({ env: { VOICE_ENGINE: "realtime" } });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest", From: "+4915112345678", To: UNKNOWN_TO }),
    });
    assert.equal(res.status, 200);
    const twiml = await res.text();
    assert.match(twiml, /<Hangup/, "nicht-routbare Nummer wird hoeflich aufgelegt");
    assert.ok(!twiml.includes('name="stream_token"'), "kein Realtime-Stream fuer unbekannte To");
    await waitForLog(srv, /\[audit\] inbound_unrouted/);
    assert.equal(srv.readStore().calls.length, 0, "kein Geist-Call fuer unbekannte To");
  } finally {
    await srv.stop();
  }
});

test("fehlende To -> fail-closed Hangup + Audit, kein Call-Record", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest", From: "+4915112345678" }),
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<Hangup/);
    await waitForLog(srv, /\[audit\] inbound_unrouted/);
    assert.equal(srv.readStore().calls.length, 0);
  } finally {
    await srv.stop();
  }
});

test("bekannte Owner-To -> normaler Greeting + Call-Record", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest", From: "+4915112345678", To: OWNER_TEST_NUMBER.e164 }),
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<Gather/, "Owner-Nummer fuehrt in den Gespraechs-Turn");
    const calls = srv.readStore().calls;
    assert.equal(calls.length, 1, "genau ein Call-Record fuer die Owner-Nummer");
    assert.equal(calls[0].to, OWNER_TEST_NUMBER.e164);
  } finally {
    await srv.stop();
  }
});

test("Anti-Spoof: gespoofte To ohne gueltige Signatur -> 403, kein Routing/Call-Record", async () => {
  // Signaturpruefung aktiv: das Routing (To-Lese) liegt HINTER der Signatur.
  const srv = await startServer({ env: { SKIP_TWILIO_SIGNATURE_CHECK: "false" } });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest", From: "+4915112345678", To: UNKNOWN_TO }),
    });
    assert.equal(res.status, 403, "ohne gueltige Signatur kein Zugriff aufs Routing");
    assert.equal(srv.readStore().calls.length, 0);
  } finally {
    await srv.stop();
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, makeTelnyxSigner, nowSeconds, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_NOT_FOUND = 404;

async function zustellen(srv, signer, pfad) {
  const body = new URLSearchParams({ CallSid: "CAh4b", SpeechResult: "Hallo" }).toString();
  const ts = String(nowSeconds());
  return abrufMitFrist(`${srv.localUrl}${pfad}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "telnyx-signature-ed25519": signer.sign(ts, body),
      "telnyx-timestamp": ts,
    },
    body,
  });
}

test("H4b: /voice/turn mit gueltiger Telnyx-Signatur liefert 404 und kein Gather", async () => {
  const signer = makeTelnyxSigner();
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64 },
  });
  try {
    const res = await zustellen(srv, signer, "/voice/turn?callId=call_h4b&turnToken=abc");
    assert.equal(res.status, HTTP_NOT_FOUND);
    assert.doesNotMatch(await res.text(), /<Gather/);
  } finally {
    await srv.stop();
  }
});

test("H4b: /voice/turn mit ungueltiger Signatur bleibt 403", async () => {
  const signer = makeTelnyxSigner();
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64 },
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/voice/turn?callId=call_h4b`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "CallSid=CAh4b",
    });
    assert.equal(res.status, 403);
  } finally {
    await srv.stop();
  }
});

test("H4b: /voice/outbound eines Anrufs ohne ElevenLabs-Profil legt nach dem Abheben auf, ohne Gather", async () => {
  const id = "call_h4b_alt";
  const srv = await startServer({
    seed: seedState({ calls: [seedCall({ id, provider: "telnyx", status: "active", direction: "outbound" })] }),
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/voice/outbound?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAh4balt" }),
    });
    const xml = await res.text();
    assert.equal(res.status, 200);
    assert.match(xml, /<Hangup\/>/);
    assert.doesNotMatch(xml, /<Gather|<Say|<Redirect/);
    const gespeichert = srv.readStore().calls.find((call) => call.id === id);
    assert.ok(gespeichert.answeredAt, "das Abheben wird vermerkt");
    assert.equal(gespeichert.twilioSid, "CAh4balt");
  } finally {
    await srv.stop();
  }
});

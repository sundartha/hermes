import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, makeTelnyxSigner, nowSeconds, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";

const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;
const CALL_ID = "call_h3b_uebergabe";

function signiert(signer, pfad) {
  const body = new URLSearchParams({ CallSid: "CAh3b" }).toString();
  const ts = String(nowSeconds());
  return {
    pfad,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "telnyx-signature-ed25519": signer.sign(ts, body),
      "telnyx-timestamp": ts,
    },
    body,
  };
}

async function mitPruefendemServer(signer, seed, arbeit) {
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64 },
    seed,
  });
  try {
    await arbeit(srv);
  } finally {
    await srv.stop();
  }
}

test("H3b: /voice/outbound mit gueltiger Telnyx-Signatur liefert 404, kein Dial und kein Abheben-Vermerk", async () => {
  const signer = makeTelnyxSigner();
  const call = seedCall({
    id: CALL_ID,
    provider: "telnyx",
    status: "active",
    direction: "outbound",
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    streamToken: "h".repeat(32),
  });
  await mitPruefendemServer(signer, seedState({ calls: [call] }), async (srv) => {
    const anfrage = signiert(signer, `/voice/outbound?callId=${CALL_ID}`);
    const res = await abrufMitFrist(`${srv.localUrl}${anfrage.pfad}`, anfrage);
    assert.equal(res.status, HTTP_NOT_FOUND);
    assert.doesNotMatch(await res.text(), /<Dial|<Sip|<Hangup/);
    const gespeichert = srv.readStore().calls.find((eintrag) => eintrag.id === CALL_ID);
    assert.equal(gespeichert.answeredAt ?? null, null);
    assert.equal(gespeichert.status, "active");
  });
});

test("H3b: /voice/outbound mit ungueltiger Signatur bleibt 403", async () => {
  const signer = makeTelnyxSigner();
  await mitPruefendemServer(signer, undefined, async (srv) => {
    const res = await abrufMitFrist(`${srv.localUrl}/voice/outbound?callId=${CALL_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "CallSid=CAh3b",
    });
    assert.equal(res.status, HTTP_FORBIDDEN);
  });
});

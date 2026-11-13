import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, makeTelnyxSigner, nowSeconds, OWNER_TEST_NUMBER } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const CACHE_GROESSE = 200;

function zustellen(srv, signer, callSid) {
  const body = new URLSearchParams({
    CallSid: callSid,
    From: "+4915112345678",
    To: OWNER_TEST_NUMBER.e164,
  }).toString();
  const ts = String(nowSeconds());
  return abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "telnyx-signature-ed25519": signer.sign(ts, body),
      "telnyx-timestamp": ts,
    },
    body,
  });
}

async function wiederholungNachDerErsten(weitereZustellungen) {
  const signer = makeTelnyxSigner();
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64 },
  });
  try {
    const erste = await (await zustellen(srv, signer, "CAmerker0")).text();
    for (let i = 1; i <= weitereZustellungen; i += 1) await zustellen(srv, signer, `CAmerker${i}`);
    const wieder = await (await zustellen(srv, signer, "CAmerker0")).text();
    return { erste, wieder };
  } finally {
    await srv.stop();
  }
}

test("Zustell-Merker: bei genau 200 Zustellungen wird die erste noch aus dem Merker beantwortet", async () => {
  const { erste, wieder } = await wiederholungNachDerErsten(CACHE_GROESSE - 1);
  assert.equal(wieder, erste);
});

test("Zustell-Merker: die 201. Zustellung verdraengt die aelteste, die Wiederholung bekommt die Fortsetzungsantwort", async () => {
  const { erste, wieder } = await wiederholungNachDerErsten(CACHE_GROESSE);
  assert.notEqual(wieder, erste);
});

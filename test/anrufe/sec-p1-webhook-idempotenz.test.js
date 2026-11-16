import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  seedState,
  seedCall,
  makeTelnyxSigner,
  nowSeconds,
  OWNER_TEST_NUMBER,
} from "../helpers.js";
import { incomingAnchors } from "../../src/telephony/webhook-idempotenz.ts";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;

function sealedEnvelope(signer, fields) {
  const body = new URLSearchParams(fields).toString();
  const ts = String(nowSeconds());
  return {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "telnyx-signature-ed25519": signer.sign(ts, body),
      "telnyx-timestamp": ts,
    },
  };
}

function deliver(srv, url, envelope) {
  return abrufMitFrist(`${srv.localUrl}${url}`, {
    method: "POST",
    headers: envelope.headers,
    body: envelope.body,
  });
}

test("SEC-P1-1: /voice/incoming zweimal zugestellt -> EIN Anruf-Datensatz, beide 200", async () => {
  const signer = makeTelnyxSigner();
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64 },
  });
  try {
    const envelope = sealedEnvelope(signer, {
      CallSid: "CAsecp1incoming",
      From: "+4915112345678",
      To: OWNER_TEST_NUMBER.e164,
    });
    const first = await deliver(srv, "/voice/incoming", envelope);
    const firstBody = await first.text();
    const second = await deliver(srv, "/voice/incoming", envelope);
    const secondBody = await second.text();

    assert.equal(first.status, HTTP_OK);
    assert.equal(second.status, HTTP_OK, "ein Anbieter-Retry ist legitim - kein 4xx");
    assert.equal(secondBody, firstBody, "die Wiederholung bekommt DIESELBE Antwort");
    assert.equal(srv.readStore().calls.length, 1, "kein zweiter Anruf-Datensatz (REPLAY-01)");
  } finally {
    await srv.stop();
  }
});

test("SEC-P1-9: /voice/incoming nach Neustart - der Anruf-Datensatz IST der Anker", async () => {
  const signer = makeTelnyxSigner();
  const srv = await startServer({
    env: { SKIP_TWILIO_SIGNATURE_CHECK: "false", TELNYX_PUBLIC_KEY: signer.publicKeyBase64 },
    seed: seedState({
      calls: [
        seedCall({
          id: "call_incoming_restart",
          provider: "telnyx",
          status: "active",
          twilioSid: "CAsecp1restart",
        }),
      ],
    }),
  });
  try {
    const envelope = sealedEnvelope(signer, {
      CallSid: "CAsecp1restart",
      From: "+4915112345678",
      To: OWNER_TEST_NUMBER.e164,
    });
    const res = await deliver(srv, "/voice/incoming", envelope);
    const xml = await res.text();
    assert.equal(res.status, HTTP_OK);
    assert.doesNotMatch(xml, /<Gather/, "keepAliveXml startet keine Gather-Runde mehr");
    assert.equal(srv.readStore().calls.length, 1, "kein zweiter Anruf-Datensatz entsteht");
  } finally {
    await srv.stop();
  }
});

test("SEC-P1-8: Anker-Ableitung an den Raendern - leere Liste statt Throw", () => {
  assert.deepEqual(incomingAnchors({ body: { CallSid: "CAx" } }), ["in:CAx"]);
  assert.deepEqual(incomingAnchors({ body: {} }), [], "fehlende CallSid -> kein Anker");
  assert.deepEqual(incomingAnchors({}), [], "gar kein Body -> kein Anker");
});

test("Anker-Ableitung: Nicht-Text (Zahl, Array, Objekt, null, leer) ergibt keinen Anker", () => {
  for (const wert of [5, ["a"], { a: 1 }, null, ""]) {
    assert.deepEqual(incomingAnchors({ body: { CallSid: wert } }), []);
  }
  assert.deepEqual(incomingAnchors({ body: { CallSid: "CAy" } }), ["in:CAy"]);
});

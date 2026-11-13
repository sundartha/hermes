import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { startInboundHarness } from "../helpers/inbound-router-harness.js";

const NUMMER = "+4930123456";

const posten = (url, pfad, felder) =>
  abrufMitFrist(`${url}${pfad}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(felder),
  });

test("Gespraechsrunde ohne Sprache bei einem Anrufer, der noch nichts gesagt hat: die Stillezaehlung bleibt stehen", async () => {
  const harness = await startInboundHarness({
    seed: { numbers: [{ id: "num_s", e164: NUMMER, tenantId: "t_stille", provider: "telnyx", status: "active", language: "de" }] },
  });
  try {
    const { store } = harness;
    Object.assign(store, { recordWebhookAnchors: () => {}, markInboundElFallback: () => {}, recordFailureReason: () => {}, save: () => {} });
    await posten(harness.url, "/voice/incoming", { From: "+491700000000", To: NUMMER, CallSid: "CAstille1" });
    const [anruf] = store.load().calls;
    anruf.noSpeechStreak = 2;
    const geleert = [];
    Object.assign(store, {
      clearNoSpeechStreak: (id) => {
        geleert.push(id);
        store.getCall(id).noSpeechStreak = 0;
      },
    });
    await posten(harness.url, `/voice/turn?callId=${anruf.id}`, { CallSid: "CAstille1" });
    assert.deepEqual(geleert, []);
    assert.equal(anruf.noSpeechStreak, 2);
  } finally {
    await harness.stop();
  }
});

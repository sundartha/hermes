import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, OWNER_TEST_NUMBER } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const CALL_ID = "call_e2e03";
const DE_VOICE = /voice="Polly\.Vicki-Neural"/;
const DE_STT = /language="de-DE"/;
const EN_STT = /language="en-GB"/;

function midCallSeed() {
  return seedState({
    settings: { language: "en" },
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }],
    numbers: [
      {
        id: "num_owner_de",
        e164: OWNER_TEST_NUMBER.e164,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
        country: "DE",
        language: "de",
      },
    ],
    calls: [
      seedCall({
        id: CALL_ID,
        direction: "inbound",
        language: "de",
        status: "active",
        transcript: [{ role: "caller", text: "Guten Tag" }],
      }),
    ],
  });
}

const emptyTurn = (srv) =>
  fetch(`${srv.localUrl}/voice/turn?callId=${CALL_ID}`, {
    method: "POST",
    body: new URLSearchParams({ SpeechResult: "" }),
  });

test("E2E-03 - Sprachumstellung waehrend des Anrufs laesst den laufenden Turn auf de", async () => {
  const srv = await startServer({ seed: midCallSeed() });
  try {
    const turn1 = await emptyTurn(srv);
    assert.equal(turn1.status, 200);
    const xml1 = await turn1.text();
    assert.match(xml1, DE_STT);
    assert.match(xml1, DE_VOICE);
    assert.doesNotMatch(xml1, EN_STT);

    const turn2 = await emptyTurn(srv);
    assert.equal(turn2.status, 200);
    const xml2 = await turn2.text();
    assert.match(xml2, DE_STT, "der laufende Anruf bleibt auf de, trotz settings.language=en");
    assert.match(xml2, DE_VOICE);
    assert.doesNotMatch(xml2, EN_STT);
  } finally {
    await srv.stop();
  }
});

test("E2E-03 - erst der NAECHSTE Anruf traegt die neue Sprache (en)", async () => {
  const srv = await startServer({ seed: midCallSeed() });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({
        CallSid: "CAe2e03next",
        From: "+4915112345678",
        To: OWNER_TEST_NUMBER.e164,
      }),
    });
    assert.equal(res.status, 200);
    const xml = await res.text();
    assert.match(xml, EN_STT, "der NEUE Anruf traegt die neue Sprache");

    const newCall = srv
      .readStore()
      .calls.find((c) => c.direction === "inbound" && c.id !== CALL_ID);
    assert.ok(newCall, "neuer Call-Record muss existieren");
    assert.equal(newCall.language, "en");
  } finally {
    await srv.stop();
  }
});

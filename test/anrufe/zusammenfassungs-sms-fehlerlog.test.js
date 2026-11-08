import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitUntil, DOMESTIC_TEST_NUMBER } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const ANSWERED_AT = "2026-01-01T00:00:00.000Z";
const ENDED_AT = "2026-01-01T00:05:00.000Z";
const HTTP_OK = 200;
const WARTEZEIT_MS = 5000;
const EIGENE_NUMMER = "+4915199998888";

test("scheitert die Zusammenfassungs-SMS, nennt das Betriebslog den Fehler ohne Verweis auf Twilio", async () => {
  const seed = seedState({
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas", privateNumber: EIGENE_NUMMER }],
    numbers: [
      {
        id: "num_sms",
        e164: DOMESTIC_TEST_NUMBER.e164,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
    calls: [
      seedCall({
        id: "sms_fehler",
        direction: "outbound",
        from: DOMESTIC_TEST_NUMBER.e164,
        to: "+4915112345678",
        status: "completed",
        answeredAt: ANSWERED_AT,
        endedAt: ENDED_AT,
        summary: "Kurze Zusammenfassung.",
        transcript: [{ role: "caller", text: "Guten Tag, ich moechte einen Termin.", at: ANSWERED_AT }],
      }),
    ],
  });
  const srv = await startServer({ env: { SEND_SMS_SUMMARY: "true", TELNYX_API_KEY: "" }, seed });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=sms_fehler`, {
      method: "POST",
      body: new URLSearchParams({ CallStatus: "completed" }),
    });
    assert.equal(res.status, HTTP_OK);
    await waitUntil(() => srv.stdout.includes("[sms]"), { timeoutMs: WARTEZEIT_MS });
    const zeile = srv.stdout.split("\n").find((z) => z.includes("[sms]"));
    assert.match(zeile, /sendSms/);
    assert.doesNotMatch(zeile, /twilio/i);
  } finally {
    await srv.stop();
  }
});

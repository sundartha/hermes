import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
import { startServer, seedState, seedCall, waitUntil, DOMESTIC_TEST_NUMBER } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const WARTEZEIT_MS = 5000;
const BESTEHEND = "Bestehende Zusammenfassung aus dem Anruf.";
const NEU = "Neue Zusammenfassung vom Modell.";
const ANSWERED_AT = "2026-01-01T00:00:00.000Z";
const ENDED_AT = "2026-01-01T00:05:00.000Z";

let modellText = "{}";
const stub = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "msg_el_zusammenfassung",
        type: "message",
        role: "assistant",
        model: "claude-haiku-4-5",
        content: [{ type: "text", text: modellText }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
    );
  });
});
await new Promise((bereit) => stub.listen(0, "127.0.0.1", bereit));
after(() => stub.close());

async function beendeElOutbound(modell) {
  modellText = modell;
  const seed = seedState({
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas" }],
    numbers: [
      {
        id: "num_el",
        e164: DOMESTIC_TEST_NUMBER.e164,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
    calls: [
      seedCall({
        id: "el_zus",
        direction: "outbound",
        provider: "telnyx",
        costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
        from: DOMESTIC_TEST_NUMBER.e164,
        status: "completed",
        answeredAt: ANSWERED_AT,
        endedAt: ENDED_AT,
        summary: BESTEHEND,
        transcript: [{ role: "caller", text: "Guten Tag, ich moechte einen Termin.", at: ANSWERED_AT }],
      }),
    ],
  });
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${stub.address().port}` },
    seed,
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=el_zus`, {
      method: "POST",
      body: new URLSearchParams({ CallStatus: "completed" }),
    });
    assert.equal(res.status, HTTP_OK);
    const anruf = () => srv.readStore().calls.find((c) => c.id === "el_zus");
    await waitUntil(() => anruf().objectiveAchieved === "unclear", { timeoutMs: WARTEZEIT_MS });
    return anruf().summary;
  } finally {
    await srv.stop();
  }
}

test("ElevenLabs-Outbound: leere Modell-Zusammenfassung laesst die bestehende Zusammenfassung stehen", async () => {
  assert.equal(await beendeElOutbound('{"summary": ""}'), BESTEHEND);
});

test("ElevenLabs-Outbound: nichtleere Modell-Zusammenfassung ersetzt die bestehende", async () => {
  assert.equal(await beendeElOutbound(JSON.stringify({ summary: NEU })), NEU);
});

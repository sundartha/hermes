// P2/OT-4 AC5: Die Originate-Fehler-Response (POST /api/calls -> 500) darf KEINE
// rohe Provider-Fehlermeldung mehr an den Client geben (Secret-/Param-Leak, Regel
// 4/5). Offline + deterministisch: ein lokaler Telnyx-Mock antwortet mit Fehler-
// Status -> der Telnyx-Adapter wirft -> Handler-catch. Geprueft wird der HTTP-Body,
// nicht das Netz. Provider=telnyx, sobald TELNYX_NUMBER gesetzt ist (wie
// onboarding-outbound). ALLOWED_NUMBERS=TARGET, damit der Call die Gates passiert
// und den Originate ueberhaupt erreicht.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "./helpers.js";

const TELNYX_NR = "+13125550100";
const TARGET = "+4917312345678";

// Mock der Telnyx-TeXML-API, der mit Fehlerstatus + einem geheimnis-aehnlichen Body
// antwortet. Der Adapter (assertOk) wirft daraufhin "Telnyx originateCall
// fehlgeschlagen: HTTP 503" - genau diese Provider-Message darf NICHT in den
// Client-Body lecken.
async function startTelnyxErrorMock() {
  const server = http.createServer((req, res) => {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ errors: [{ detail: "boom token=SECRET_DO_NOT_LEAK" }] }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const TELNYX_ENV = (mockUrl) => ({
  TELNYX_NUMBER: TELNYX_NR,
  TELNYX_API_KEY: "KEYtest-secret",
  TELNYX_CONNECTION_ID: "conn_test",
  TELNYX_ACCOUNT_SID: "acct_test",
  TELNYX_API_BASE: mockUrl,
  ALLOWED_NUMBERS: TARGET,
});

test("T-P2-11: Originate-Fehler -> generische 500, keine rohe Provider-Message", async () => {
  const mock = await startTelnyxErrorMock();
  const srv = await startServer({ env: TELNYX_ENV(mock.url) });
  try {
    const res = await fetch(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: TARGET, objective: "Testziel" }),
    });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "Anruf konnte nicht gestartet werden.", "Body-error muss generisch sein");
    assert.ok(
      !/Telnyx|HTTP|SECRET_DO_NOT_LEAK/.test(JSON.stringify(body)),
      `rohe Provider-Details im Body: ${JSON.stringify(body)}`
    );
    assert.ok(body.hint && body.hint.includes("Verified Caller IDs"), "statischer hint bleibt erhalten");
  } finally {
    await srv.stop();
    await mock.close();
  }
});

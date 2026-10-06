import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "./helpers.js";

const TELNYX_NR = "+13125550100";
const TARGET = "+4917312345678";

async function startTelnyxErrorMock() {
  const server = http.createServer((req, res) => {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ errors: [{ detail: "boom token=SECRET_DO_NOT_LEAK" }] }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

const TELNYX_ENV = (mockUrl) => ({
  TELNYX_NUMBER: TELNYX_NR,
  TELNYX_API_KEY: "KEYtest-secret",
  TELNYX_CONNECTION_ID: "conn_test",
  TELNYX_ACCOUNT_SID: "acct_test",
  TELNYX_API_BASE: mockUrl,
  ALLOWED_NUMBERS: TARGET,
});

test("T-P2-11: Originate-Fehler -> kategorisierte 502 (Statusklasse sichtbar), kein Secret/Provider-Name/Twilio-Hint bei Telnyx", async () => {
  const mock = await startTelnyxErrorMock();
  const srv = await startServer({
    env: TELNYX_ENV(mock.url),
    ownerNumber: { e164: TELNYX_NR, provider: "telnyx" },
  });
  try {
    const res = await fetch(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: TARGET, objective: "Testziel" }),
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.match(body.error, /HTTP 503/, "Statusklasse sichtbar fuer Diagnose");
    assert.ok(
      !/Telnyx|SECRET_DO_NOT_LEAK|token=/.test(JSON.stringify(body)),
      `Secret/Provider-Name/Roh-Body im Body: ${JSON.stringify(body)}`,
    );
    assert.ok(
      !body.hint,
      "kein Twilio-Trial-Hint bei Provider Telnyx (war die irrefuehrende Meldung)",
    );
  } finally {
    await srv.stop();
    await mock.close();
  }
});

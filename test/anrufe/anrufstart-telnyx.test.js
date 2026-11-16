import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_BAD_GATEWAY = 502;
const HTTP_FORBIDDEN = 403;
const HTTP_SERVICE_UNAVAILABLE = 503;

const TELNYX_NR = "+13125550100";
const TARGET = "+4917312345678";

async function startTelnyxVoiceMock() {
  const requests = [];
  const attrappe = await starteAttrappe((req, res) => {
    let body = "";
    req.on("data", (teil) => (body += teil));
    req.on("end", () => {
      requests.push({ method: req.method, path: req.url, body, auth: req.headers.authorization });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ sid: "tnx_mock_call_1" }));
    });
  });
  return { ...attrappe, requests };
}

const TELNYX_ENV = (mockUrl) => ({
  TELNYX_API_KEY: "KEYtest-secret",
  TELNYX_CONNECTION_ID: "conn_test",
  TELNYX_ACCOUNT_SID: "acct_test",
  TELNYX_API_BASE: mockUrl,
  ALLOWED_NUMBERS: TARGET,
});

const TELNYX_OWNER = { e164: TELNYX_NR, provider: "telnyx", providerAgentPhoneNumberId: "phnum_anrufstart" };

const postJson = (url, body) =>
  abrufMitFrist(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("Outbound-Gates greifen weiter: gesperrtes (Premium-)Ziel -> 403 (kein Telnyx-Call)", async () => {
  const mock = await startTelnyxVoiceMock();
  const srv = await startServer({ env: TELNYX_ENV(mock.url), ownerNumber: TELNYX_OWNER });
  try {
    const res = await postJson(`${srv.localUrl}/api/calls`, {
      to: "+4990012345678",
      objective: "x",
    });
    assert.equal(res.status, HTTP_FORBIDDEN, "Premium/Denylist -> abgewiesen");
    assert.equal(mock.requests.length, 0, "kein Originate bei gesperrtem Ziel");
  } finally {
    await srv.stop();
    await mock.close();
  }
});

function startTelnyxErrorMock() {
  return starteAttrappe((req, res) => {
    res.writeHead(HTTP_SERVICE_UNAVAILABLE, { "content-type": "application/json" });
    res.end(JSON.stringify({ errors: [{ detail: "boom token=SECRET_DO_NOT_LEAK" }] }));
  });
}

const TELNYX_ENV_MIT_NUMMER = (mockUrl) => ({
  TELNYX_NUMBER: TELNYX_NR,
  TELNYX_API_KEY: "KEYtest-secret",
  TELNYX_CONNECTION_ID: "conn_test",
  TELNYX_ACCOUNT_SID: "acct_test",
  TELNYX_API_BASE: mockUrl,
  ELEVENLABS_API_BASE: mockUrl,
  ALLOWED_NUMBERS: TARGET,
});

test("T-P2-11: Originate-Fehler -> kategorisierte 502 (Statusklasse sichtbar), kein Secret/Provider-Name/Twilio-Hint bei Telnyx", async () => {
  const mock = await startTelnyxErrorMock();
  const srv = await startServer({
    env: TELNYX_ENV_MIT_NUMMER(mock.url),
    ownerNumber: TELNYX_OWNER,
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: TARGET, objective: "Testziel" }),
    });
    assert.equal(res.status, HTTP_BAD_GATEWAY);
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

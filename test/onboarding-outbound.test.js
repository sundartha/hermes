// Outbound ueber Telnyx end-to-end (Server-Kindprozess): POST /api/calls waehlt
// Telnyx als Provider, weil die aktive Owner-Nummer im Store eine Telnyx-Nummer ist
// (provider aus s.numbers, nicht mehr aus TELNYX_NUMBER-Env) - from = Telnyx-Nummer,
// originate ueber die TeXML-API. Statt der echten Telnyx-API laeuft ein lokaler
// Mock (TELNYX_API_BASE zeigt darauf) -> offline + deterministisch, KEIN echter
// Anruf. Eigene Datei (Server-Spawn, KEIN pglite -> kein Test-Worker-Stall).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "./helpers.js";

const TELNYX_NR = "+13125550100";
const TARGET = "+4917312345678"; // Owner-Handy (Allowlist)

// Mock der Telnyx-TeXML-VOICE-API (Outbound-Originate): zeichnet den Initiate-Request
// auf und liefert eine Twilio-kompatible Call-Resource ({sid}). Liefert {url, requests,
// close}. Name "...VoiceMock" disjunkt vom Provisioning-Mock in helpers.js
// (startTelnyxProvisioningMock) - zwei verschiedene Telnyx-APIs (TD-9).
async function startTelnyxVoiceMock() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push({ method: req.method, path: req.url, body, auth: req.headers.authorization });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ sid: "tnx_mock_call_1" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, requests, close: () => new Promise((r) => server.close(r)) };
}

const TELNYX_ENV = (mockUrl) => ({
  TELNYX_API_KEY: "KEYtest-secret",
  TELNYX_CONNECTION_ID: "conn_test",
  TELNYX_ACCOUNT_SID: "acct_test",
  TELNYX_API_BASE: mockUrl,
  ALLOWED_NUMBERS: TARGET,
});

// Owner-Absendernummer = Telnyx-Nummer im Store -> Outbound waehlt Telnyx (provider
// aus s.numbers, statt frueher TELNYX_NUMBER-Env).
const TELNYX_OWNER = { e164: TELNYX_NR, provider: "telnyx" };

const postJson = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("POST /api/calls mit Telnyx-Owner-Nummer im Store -> provider=telnyx, from=Telnyx-Nummer, TeXML-Originate", async () => {
  const mock = await startTelnyxVoiceMock();
  const srv = await startServer({ env: TELNYX_ENV(mock.url), ownerNumber: TELNYX_OWNER });
  try {
    const res = await postJson(`${srv.localUrl}/api/calls`, { to: TARGET, objective: "Testziel" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, "dialing");
    assert.equal(json.twilioSid, "tnx_mock_call_1", "CallSid aus der Telnyx-Antwort uebernommen");

    // Mock hat genau einen Initiate-Request erhalten, auf dem connection_id-Pfad.
    assert.equal(mock.requests.length, 1);
    const r = mock.requests[0];
    assert.equal(r.method, "POST");
    assert.equal(r.path, "/v2/texml/calls/conn_test");
    assert.equal(r.auth, "Bearer KEYtest-secret");
    const form = new URLSearchParams(r.body);
    assert.equal(form.get("From"), TELNYX_NR, "From = Telnyx-Owner-Nummer");
    assert.equal(form.get("To"), TARGET);
    assert.match(form.get("Url"), /\/voice\/outbound\?callId=/);

    // Call-Record traegt provider=telnyx + from=Telnyx-Nummer.
    const calls = srv.readStore().calls;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].provider, "telnyx");
    assert.equal(calls[0].from, TELNYX_NR);
    assert.equal(calls[0].direction, "outbound");
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test("Outbound-Gates greifen weiter: nicht erlaubte Nummer -> 403 (kein Telnyx-Call)", async () => {
  const mock = await startTelnyxVoiceMock();
  const srv = await startServer({ env: TELNYX_ENV(mock.url), ownerNumber: TELNYX_OWNER });
  try {
    const res = await postJson(`${srv.localUrl}/api/calls`, {
      to: "+491110000000",
      objective: "x",
    });
    assert.equal(res.status, 403, "nicht in der Allowlist -> abgewiesen");
    assert.equal(mock.requests.length, 0, "kein Originate bei gesperrtem Ziel");
  } finally {
    await srv.stop();
    await mock.close();
  }
});

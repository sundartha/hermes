import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { seedCall, seedState, startServer, waitForLog, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TO = "+4915112345678";
const HTTP_OK = 200;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_UPSTREAM_ERROR = 502;
const MESSZEILE = /\[metrics\] call_capacity (\{[^}]*\})/g;

const messzeilen = (srv) => [...srv.stdout.matchAll(MESSZEILE)].map((treffer) => treffer[1]);

const telnyxAnruf = (id) => seedCall({ id, provider: "telnyx" });
const ANRUF_IDS = ["mz_nur_403", "mz_unreachable", "mz_403", "mz_ohne_sip"];

let server;
let serverOhneMessung;

before(async () => {
  const seed = () => seedState({ calls: ANRUF_IDS.map(telnyxAnruf) });
  server = await startServer({ seed: seed(), env: { METRICS_ENABLED: "true" } });
  serverOhneMessung = await startServer({ seed: seed() });
});

after(async () => {
  await server?.stop();
  await serverOhneMessung?.stop();
});

async function meldeStatus(srv, id, felder) {
  const antwort = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${id}`, {
    method: "POST",
    body: new URLSearchParams({ CallStatus: "failed", ...felder }),
  });
  assert.equal(antwort.status, HTTP_OK);
  const stand = await waitForStoreState(srv, (st) => (st.notifications ?? []).some((eintrag) => eintrag.callId === id));
  return stand.calls.find((anruf) => anruf.id === id);
}

test("Messzeile call_capacity: nur bei at-capacity, je Anruf einmal, mit dem Teil nach dem Doppelpunkt", async () => {
  const nur403 = await meldeStatus(server, "mz_nur_403", { SipHangupCause: "403" });
  assert.equal(nur403.failureReason, "not-placed:invite-403");
  const unreachable = await meldeStatus(server, "mz_unreachable", { SipHangupCause: "486", HangupCause: "channel_limit" });
  assert.equal(unreachable.failureReason, "unreachable:invite-486");
  const mitSip = await meldeStatus(server, "mz_403", { SipHangupCause: "403", HangupCause: "channel_limit" });
  assert.equal(mitSip.failureReason, "at-capacity:invite-403");
  const ohneSip = await meldeStatus(server, "mz_ohne_sip", { HangupCause: "channel_limit" });
  assert.equal(ohneSip.failureReason, "at-capacity:invite");

  await waitForLog(server, /call_capacity \{"detail":"invite"\}/);
  assert.deepEqual(messzeilen(server), ['{"detail":"invite-403"}', '{"detail":"invite"}']);
});

test("Messzeile call_capacity: mit METRICS_ENABLED=false schweigt sie", async () => {
  const anruf = await meldeStatus(serverOhneMessung, "mz_403", { SipHangupCause: "403", HangupCause: "channel_limit" });
  assert.equal(anruf.failureReason, "at-capacity:invite-403");
  assert.deepEqual(messzeilen(serverOhneMessung), []);
});

async function startMockMitStatus(status) {
  const mock = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ errors: [{ code: "10000", title: "Too many" }] }));
    });
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${mock.address().port}`,
    close: () => new Promise((resolve) => mock.close(resolve)),
  };
}

test("POST /api/calls mit Anbieterstatus 429: Antwort bleibt 502, Anruf traegt at-capacity:start-429, eine Zeile call_capacity", async () => {
  const mock = await startMockMitStatus(HTTP_TOO_MANY_REQUESTS);
  const srv = await startServer({
    env: {
      TELNYX_API_KEY: "KEYtest-secret",
      TELNYX_CONNECTION_ID: "conn_test",
      TELNYX_ACCOUNT_SID: "acct_test",
      TELNYX_API_BASE: mock.url,
      METRICS_ENABLED: "true",
    },
    ownerNumber: { e164: "+13125550100", provider: "telnyx" },
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: TO, objective: "Termin vereinbaren" }),
    });
    const body = await res.json();
    assert.equal(res.status, HTTP_UPSTREAM_ERROR);
    assert.match(body.error, /Provider hat den Anruf abgelehnt \(HTTP 429\)/);
    assert.match(body.error, /Account-\/Nummern-Konfiguration pruefen/);

    const anrufe = srv.readStore().calls.filter((entry) => entry.direction === "outbound" && entry.to === TO);
    assert.equal(anrufe.length, 1);
    assert.equal(anrufe[0].failureReason, "at-capacity:start-429");

    await waitForLog(srv, /call_capacity \{"detail":"start-429"\}/);
    assert.deepEqual(messzeilen(srv), ['{"detail":"start-429"}']);
  } finally {
    await srv.stop();
    await mock.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeCallFinish } from "../../src/telephony/call-finish.js";
import { createMetrics } from "../../src/metrics.js";
import { seedCall, startServer, waitForLog } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const ONE_HOUR_MS = 3600000;
const TO = "+4915112345678";
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_UPSTREAM_ERROR = 502;

const config = {
  billing: {
    paymentEnabled: false,
    smsCostCents: 0,
    outageAlertWindowMs: ONE_HOUR_MS,
    outageAlertMinFailures: 5,
    outageAlertMinAttempts: 50,
    outageAlertFailSharePercent: 50,
    outageAlertDebounceMs: 21600000,
    outageAlertRetryMs: 900000,
    platformAlertSmsTo: "",
  },
  privacy: {},
  server: { publicUrl: "https://hermes.example.test" },
  mail: { platformAlertMailTo: "" },
};

function fakeStore(calls) {
  const state = { calls, outageAlerts: [], platformNumberUse: [] };
  return {
    load: () => state,
    withStoreLock: (fn) => Promise.resolve().then(fn),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: () => {},
    purgeTranscript: () => {},
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    markBilled: () => {},
    markInboxEntry: () => {},
    markNotPlacedMailSent: () => {},
  };
}

function metricsSpy() {
  const zeilen = [];
  const metrics = createMetrics({ enabled: true, log: (kind, payload) => zeilen.push({ kind, payload }) });
  return { zeilen, metrics };
}

function makeFinish(store, metrics) {
  return makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall: async () => null,
    planSummarySms: () => ({ send: false, reason: null }),
    audit: () => {},
    mailer: { sendMail: async () => {} },
    accountsRef: { current: { accountByTenant: async () => null } },
    ...(metrics ? { metrics } : {}),
  });
}

function failedCall(failureReason) {
  return seedCall({
    status: "failed",
    direction: "outbound",
    to: "+12025550143",
    endedAt: "2026-08-27T10:00:00.000Z",
    failureReason,
  });
}

const FAELLE = [
  ["at-capacity:start-429", "start-429"],
  ["at-capacity:invite-403", "invite-403"],
  ["at-capacity:invite", "invite"],
];

for (const [grund, detail] of FAELLE) {
  test(`Messzeile am Anrufende: ${grund} schreibt call_capacity mit detail ${detail}, einmal je Anruf`, async () => {
    const call = failedCall(grund);
    const { zeilen, metrics } = metricsSpy();
    const finish = makeFinish(fakeStore([call]), metrics);

    await finish.finishCall(call);
    await finish.finishCall(call);

    assert.deepEqual(zeilen, [{ kind: "call_capacity", payload: { detail } }]);
  });
}

for (const grund of ["not-placed:invite-403", "not-placed:start-403", "unreachable:invite-480", "result-unknown:start-503", "at-capacity", "failed", "at-capacity:poll-timeout", "at-capacity:invitex", "at-capacity:xstart-429"]) {
  test(`Messzeile am Anrufende: ${grund} schreibt keine call_capacity`, async () => {
    const call = failedCall(grund);
    const { zeilen, metrics } = metricsSpy();

    await makeFinish(fakeStore([call]), metrics).finishCall(call);

    assert.deepEqual(zeilen, []);
  });
}

test("Messzeile: createMetrics schweigt bei enabled=false", () => {
  const zeilen = [];
  createMetrics({ enabled: false, log: (kind, payload) => zeilen.push({ kind, payload }) }).logCallCapacity({ detail: "start-429" });
  assert.deepEqual(zeilen, []);
});

test("finishCall ohne metrics-Parameter meldet at-capacity ohne Fehler", async () => {
  const call = failedCall("at-capacity:start-429");
  await assert.doesNotReject(() => makeFinish(fakeStore([call])).finishCall(call));
});

async function startMockMitStatus(status) {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ errors: [{ code: "10000", title: "Too many" }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
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

    await waitForLog(srv, /\[metrics\] call_capacity \{"detail":"start-429"\}/);
    const treffer = srv.stdout.match(/\[metrics\] call_capacity /g) || [];
    assert.equal(treffer.length, 1);
  } finally {
    await srv.stop();
    await mock.close();
  }
});

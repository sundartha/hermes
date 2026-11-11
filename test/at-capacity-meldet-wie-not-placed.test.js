import test from "node:test";
import assert from "node:assert/strict";
import { planNotPlacedMail } from "../src/mail-not-placed.js";
import { reportSystematicOutage, runOutageRecoverySweep } from "../src/telephony/outage-report.js";
import { makePgTestStore } from "./pg-helpers.js";
import { callFailureReason, startRejectionReason } from "../src/telephony/failure-reason.js";

const ENDED = "2026-08-27T16:45:00Z";
const CAPACITY_BUCKET = "at-capacity:invite-403";
const MARKER = Object.freeze({
  id: "otg_1", code: CAPACITY_BUCKET, firstSeenAt: "2026-08-27T16:00:00Z", lastSeenAt: "2026-08-27T16:00:00Z",
  lastAttemptAt: null, reportedAt: null, deliveredChannels: null, closedAt: null,
});
const CONFIG = Object.freeze({
  billing: {
    outageAlertWindowMs: 3600000,
    outageAlertMinFailures: 3,
    outageAlertMinAttempts: 20,
    outageAlertFailSharePercent: 20,
    outageAlertDebounceMs: 21600000,
    outageAlertRetryMs: 900000,
    platformAlertSmsTo: "",
  },
  mail: { platformAlertMailTo: "ops@example.test" },
});

function callRow(id, endedAt, failureReason) {
  return { id, tenantId: "t_user_01ABC", direction: "outbound", endedAt, answeredAt: null, failureReason, to: "+12025550199" };
}

async function makeStore(calls, outageAlerts = []) {
  const { store } = await makePgTestStore();
  const state = store.load();
  state.calls.push(...calls);
  state.outageAlerts.push(...outageAlerts);
  return store;
}

async function mailPlan(failureReason) {
  const call = callRow("call_x", ENDED, failureReason);
  const accounts = { accountByTenant: async () => ({ email: "kunde@example.test" }) };
  return planNotPlacedMail({ store: await makeStore([call]), call, mailer: {}, accounts });
}

test("Kunden-Mail geht bei 429 beim Start und bei Kanalgrenze wie bei not-placed", async () => {
  const start429 = startRejectionReason(429);
  const kanal = callFailureReason({ status: "failed", diagnostics: { sipHangupCause: "403", hangupCause: "channel_limit" } });
  assert.match(start429, /^at-capacity:start-429/);
  assert.match(kanal, /^at-capacity:invite-403/);
  for (const grund of [start429, kanal]) {
    const plan = await mailPlan(grund);
    assert.equal(plan.send, true, grund);
    assert.deepEqual(plan.targets, [{ email: "kunde@example.test", unsubToken: null }]);
  }
});

test("Kunden-Mail wird zwischen at-capacity und not-placed derselben Stunde entprellt", async () => {
  const frueher = callRow("call_a", "2026-08-27T16:30:00Z", CAPACITY_BUCKET);
  const call = callRow("call_b", ENDED, "not-placed:start-403");
  const accounts = { accountByTenant: async () => ({ email: "kunde@example.test" }) };
  const plan = await planNotPlacedMail({ store: await makeStore([frueher, call]), call, mailer: {}, accounts });
  assert.equal(plan.send, false);
});

test("Ausfallalarm zaehlt at-capacity-Eimer mit denselben Schwellen", async () => {
  const calls = [
    callRow("call_a", "2026-08-27T16:43:00Z", CAPACITY_BUCKET),
    callRow("call_b", "2026-08-27T16:44:00Z", CAPACITY_BUCKET),
    callRow("call_c", ENDED, CAPACITY_BUCKET),
  ];
  const store = await makeStore(calls, [{ ...MARKER }]);
  const mails = [];
  const mailer = { async sendMail(args) { mails.push(args); } };
  await reportSystematicOutage({ store, config: CONFIG, call: calls[2], audit: () => {}, messaging: () => ({}), mailer });
  assert.equal(mails.length, 1);
  const [alarm] = store.load().outageAlerts;
  assert.ok(alarm.reportedAt);
});

test("Erholungslauf schliesst einen offenen at-capacity-Marker", async () => {
  const erfolg = { ...callRow("call_ok", "2026-08-27T16:44:00Z", null), answeredAt: "2026-08-27T16:43:50Z" };
  const store = await makeStore([erfolg], [{ ...MARKER }]);
  const aktionen = [];
  await runOutageRecoverySweep({ store, config: CONFIG, audit: (aktion) => aktionen.push(aktion), nowMs: Date.parse(ENDED) });
  const [alarm] = store.load().outageAlerts;
  assert.ok(alarm.closedAt);
  assert.deepEqual(aktionen, ["outage_recovered"]);
});

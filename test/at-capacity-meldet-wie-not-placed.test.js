import test from "node:test";
import assert from "node:assert/strict";
import { planNotPlacedMail } from "../src/mail-not-placed.js";
import { makePgTestStore } from "./pg-helpers.js";
import { callFailureReason, startRejectionReason } from "../src/telephony/failure-reason.js";

const ENDED = "2026-08-27T16:45:00Z";
const CAPACITY_BUCKET = "at-capacity:invite-403";

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

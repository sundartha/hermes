import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeCallLifecycle,
  BUDGET_FAILURE_REASON,
} from "../src/telephony/call-lifecycle.js";
import { terminateAndBillCall, hangUpAction, billThunk } from "../src/telephony/call-termination.js";
import { reattachActiveCall as reattachActiveCallCore } from "../src/telephony/reattach.js";
import { blockingBudgetAxis } from "../src/budget-gate.js";
import { cappedEndedAtMs, classifyCallTime } from "../src/store/state-ops.js";
import { VOICE_ENGINE } from "../src/config.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const MAX_DURATION_S = 180;
const RECENTLY_STARTED_MS = 30 * 1000;

function spyStore(call, order) {
  return {
    getCall: (callId) => (callId === call.id ? call : null),
    attachActiveCall: async (callId) => (callId === call.id ? call : null),
    setCallEndedAt: (callId, status, endedAtIso) => {
      order.push("setCallEndedAt");
      call.status = status;
      call.endedAt = endedAtIso;
    },
    recordFailureReason: (callId, reason) => {
      order.push("recordFailureReason");
      if (!call.failureReason) call.failureReason = reason;
    },
    activeCallsFor: () => [],
    liveBudgetExceeded: () => true,
  };
}

test("Geld-Achse: Re-Attach eines Calls mit erschoepfter Decke terminalisiert ueber die echte blockingBudgetAxis-Verdrahtung", async () => {
  const order = [];
  const call = {
    id: "call_budget",
    tenantId: "tenant_budget",
    status: "active",
    provider: "telnyx",
    twilioSid: "CA_budget_1",
    direction: "outbound",
    startedAt: new Date(Date.now() - RECENTLY_STARTED_MS).toISOString(),
    maxDurationS: MAX_DURATION_S,
  };
  let settled;
  const billed = new Promise((resolve) => {
    settled = resolve;
  });

  const lifecycle = makeCallLifecycle({
    store: spyStore(call, order),
    config: withConfigNamespaces({
      voiceEngine: VOICE_ENGINE.BUDGET,
      billing: {},
    }),
    finishCall: () => {
      order.push("bill");
      settled();
    },
    releaseReserve: () => {},
    voiceControl: () => ({
      async endCall() {
        order.push("endCall");
      },
    }),
    terminateAndBillCall,
    hangUpAction,
    billThunk,
    reattachActiveCallCore,
    cappedEndedAtMs,
    classifyCallTime,
    blockingBudgetAxis,
  });

  const result = await lifecycle.reattachActiveCall(call.id);

  await billed;

  assert.deepEqual(
    result,
    { call: null, logUnknown: false },
    "ein wegen erschoepfter Decke terminalisierter Call wird NICHT reanimiert",
  );
  assert.equal(
    call.failureReason,
    BUDGET_FAILURE_REASON,
    "an der Geld-Achse gestorbener Re-Attach traegt den Budget-Grund",
  );
  assert.equal(
    call.status,
    "completed",
    "Geld-Achse terminalisiert als completed (das Leg war technisch gesund), nicht failed",
  );
  assert.deepEqual(
    order,
    ["recordFailureReason", "setCallEndedAt", "endCall", "bill"],
    "Grund liegt VOR dem Provider-Hangup und VOR dem Settlement, wie beim Cap-Pendant",
  );
});

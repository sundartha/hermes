import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallLifecycle, CAP_FAILURE_REASON } from "../src/telephony/call-lifecycle.js";
import { terminateAndBillCall, hangUpAction, billThunk } from "../src/telephony/call-termination.js";
import { cappedEndedAtMs, classifyCallTime } from "../src/store/state-ops.js";
import { VOICE_ENGINE } from "../src/config.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const MAX_DURATION_S = 60;
const LONG_AGO_MS = 60 * 60 * 1000;

function spyStore(call, order) {
  return {
    load: () => ({ calls: [call] }),
    getCall: (callId) => (callId === call.id ? call : null),
    setCallEndedAt: (callId, status, endedAtIso) => {
      order.push("setCallEndedAt");
      call.status = status;
      call.endedAt = endedAtIso;
    },
    recordFailureReason: (callId, reason) => {
      order.push("recordFailureReason");
      if (!call.failureReason) call.failureReason = reason;
    },
  };
}

test("Cap-Grund: terminateCappedCall persistiert das Cap-Token gemeinsam mit dem Endzustand - vor Hangup und Settlement", async () => {
  const order = [];
  const call = {
    id: "call_cap",
    status: "active",
    provider: "telnyx",
    twilioSid: "CA_1",
    startedAt: new Date(Date.now() - LONG_AGO_MS).toISOString(),
    maxDurationS: MAX_DURATION_S,
  };
  let settled;
  const billed = new Promise((resolve) => {
    settled = resolve;
  });

  const lifecycle = makeCallLifecycle({
    store: spyStore(call, order),
    config: withConfigNamespaces({ voiceEngine: VOICE_ENGINE.BUDGET }),
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
    reattachActiveCallCore: () => ({ call: null, logUnknown: false }),
    cappedEndedAtMs,
    classifyCallTime,
  });

  lifecycle.rearmActiveCallTimers();
  await billed;

  assert.equal(call.failureReason, CAP_FAILURE_REASON, "am Cap gestorbener Anruf traegt den Cap-Grund");
  assert.equal(call.status, "failed", "Zombie-Terminalisierung bleibt failed (INV-9 unveraendert)");
  assert.deepEqual(
    order,
    ["recordFailureReason", "setCallEndedAt", "endCall", "bill"],
    "Grund liegt VOR dem Provider-Hangup und VOR dem Settlement - die Buchungs-/Summary-Kette liest ihn bereits mit",
  );
});

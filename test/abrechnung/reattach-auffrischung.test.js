import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallLifecycle } from "../../src/telephony/call-lifecycle.ts";
import { terminateAndBillCall, hangUpAction, billThunk } from "../../src/telephony/call-termination.ts";
import { reattachActiveCall as reattachActiveCallCore } from "../../src/telephony/reattach.ts";
import { blockingBudgetAxisFrisch } from "../../src/budget-gate.js";
import { cappedEndedAtMs, classifyCallTime } from "../../src/store/state-ops.js";
import { VOICE_ENGINE } from "../../src/config.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

function lebenszyklus(uberDerDecke) {
  const call = {
    id: "call_frisch",
    tenantId: "tenant_frisch",
    status: "active",
    provider: "telnyx",
    twilioSid: "CA_frisch_1",
    direction: "outbound",
    startedAt: new Date(Date.now() - 30000).toISOString(),
    maxDurationS: 180,
  };
  const beendet = [];
  const lifecycle = makeCallLifecycle({
    store: {
      getCall: () => call,
      attachActiveCall: async () => call,
      setCallEndedAt: (id, status) => {
        call.status = status;
      },
      recordFailureReason: () => {},
      activeCallsFor: () => [],
      liveBudgetExceeded: () => uberDerDecke,
      nutzungAuffrischen: async () => true,
    },
    config: withConfigNamespaces({ voiceEngine: VOICE_ENGINE.BUDGET, billing: {} }),
    finishCall: () => {},
    releaseReserve: () => {},
    voiceControl: () => ({
      async endCall() {
        beendet.push(call.id);
      },
    }),
    terminateAndBillCall,
    hangUpAction,
    billThunk,
    reattachActiveCallCore,
    cappedEndedAtMs,
    classifyCallTime,
    blockingBudgetAxis: blockingBudgetAxisFrisch,
  });
  return { lifecycle, call, beendet };
}

test("Re-Attach unter der Decke laesst den Anruf mit der frischen Geld-Wache weiterlaufen", async () => {
  const { lifecycle, call, beendet } = lebenszyklus(false);
  const result = await lifecycle.reattachActiveCall(call.id);
  assert.equal(result.call, call);
  assert.equal(call.status, "active");
  assert.deepEqual(beendet, []);
});

test("Re-Attach ueber der Decke beendet den Anruf mit der frischen Geld-Wache", async () => {
  const { lifecycle, call } = lebenszyklus(true);
  const result = await lifecycle.reattachActiveCall(call.id);
  assert.deepEqual(result, { call: null, logUnknown: false });
});

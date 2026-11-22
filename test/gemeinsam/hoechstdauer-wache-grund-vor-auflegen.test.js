import { test } from "node:test";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
import assert from "node:assert/strict";
import { makeCallLifecycle, CAP_FAILURE_REASON } from "../../src/telephony/call-lifecycle.ts";
import { terminateAndBillCall, hangUpAction, billThunk } from "../../src/telephony/call-termination.ts";
import { reattachActiveCall as reattachActiveCallCore } from "../../src/telephony/reattach.ts";
import { blockingBudgetAxis } from "../../src/budget-gate.js";
import { cappedEndedAtMs, classifyCallTime } from "../../src/store/state-ops.js";
import { VOICE_ENGINE } from "../../src/config.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

test("Hoechstdauer-Wache: beendet das Auflegen die ElevenLabs-Konversation und damit den Anruf, steht der Grund max-duration schon fest", async () => {
  const call = {
    id: "call_wache_hoechstdauer",
    tenantId: "tenant_wache_hoechstdauer",
    status: "active",
    provider: "elevenlabs",
    costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
    twilioSid: "",
    elevenlabsConversationId: "conv_wache_hoechstdauer",
    direction: "outbound",
    startedAt: new Date(Date.now() - 30_000).toISOString(),
    maxDurationS: 180,
  };
  const grundBeimEnde = [];
  const store = {
    getCall: () => call,
    attachActiveCall: async () => call,
    setCallEndedAt: (callId, status, endedAtIso) => {
      if (call.status !== "active") return;
      call.status = status;
      call.endedAt = endedAtIso;
    },
    recordFailureReason: (callId, reason) => {
      if (reason && !call.failureReason) call.failureReason = reason;
    },
    activeCallsFor: () => [],
    liveBudgetExceeded: () => true,
  };
  const lifecycle = makeCallLifecycle({
    store,
    config: withConfigNamespaces({ voiceEngine: VOICE_ENGINE.BUDGET, billing: {} }),
    finishCall: () => {},
    releaseReserve: () => {},
    voiceControl: () => ({ async endCall() {} }),
    terminateAndBillCall,
    hangUpAction,
    billThunk,
    endActiveCall: async () => {
      grundBeimEnde.push(call.failureReason ?? null);
      store.setCallEndedAt(call.id, "completed", new Date().toISOString());
    },
    reattachActiveCallCore,
    cappedEndedAtMs,
    classifyCallTime,
    blockingBudgetAxis,
  });
  await lifecycle.terminateExpiredCall(call);
  assert.deepEqual(grundBeimEnde, [CAP_FAILURE_REASON]);
  assert.equal(call.failureReason, CAP_FAILURE_REASON);
});

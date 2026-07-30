// KS-P1b Review-Blocker Runde 1 (S1): das Pendant zu test/cap-failure-reason.test.js fuer die
// GELD-Achse. reattach-active-call.test.js und ks-p1b-shim-reattach.test.js reichen
// budgetAxisFor/terminateOverBudgetCall als Spies durch den Re-Attach-Kern - sie pruefen nie,
// dass call-lifecycle.js die ECHTE Verdrahtung traegt:
//   budgetAxisFor: (call) => blockingBudgetAxis({ store, billing: config.billing, tenantId })
//   terminateOverBudgetCall -> terminateActiveCall({ status:"completed", failureReason:
//                              BUDGET_FAILURE_REASON })
// Dieser Test faehrt makeCallLifecycle() + den echten reattachActiveCallCore (reattach.js) +
// die echte blockingBudgetAxis (budget-gate.js) durch, mit einem Spy-Store, der NUR die
// beiden Geld-Achse-Primitiven (activeOutboundCallsFor/liveBudgetExceeded) faelscht - genau
// wie cap-failure-reason.test.js den Cap-Zweig gegen die echte Orchestrierung pinnt.
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
const RECENTLY_STARTED_MS = 30 * 1000; // deutlich unter MAX_DURATION_S -> NICHT expired

// Spy-Store: die Cap-Felder aus cap-failure-reason.test.js PLUS die beiden Geld-Achse-
// Primitiven, ueber die die echte blockingBudgetAxis entscheidet - kein Fake der
// Entscheidung selbst.
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
    // Geld-Achse erschoepft: liveBudgetExceeded meldet true unabhaengig vom Live-Term, damit
    // blockingBudgetAxis(BUDGET_AXIS.TENANT) liefert - genau die reale Entscheidungsfunktion,
    // nicht ein Stub von budgetAxisFor selbst.
    activeOutboundCallsFor: () => [],
    liveBudgetExceeded: () => true,
  };
}

test("Geld-Achse: Re-Attach eines Calls mit erschoepfter Decke terminalisiert ueber die echte blockingBudgetAxis-Verdrahtung", async () => {
  const order = [];
  const call = {
    id: "call_budget",
    tenantId: "tenant_budget",
    status: "active",
    provider: "twilio",
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
    reattachActiveCallCore, // echter Kern (reattach.js), kein Spy
    cappedEndedAtMs,
    classifyCallTime,
    blockingBudgetAxis, // echte Geld-Achse (budget-gate.js), kein Spy
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
    ["setCallEndedAt", "recordFailureReason", "endCall", "bill"],
    "Grund liegt VOR dem Provider-Hangup und VOR dem Settlement, wie beim Cap-Pendant",
  );
});

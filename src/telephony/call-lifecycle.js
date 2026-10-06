import { callMaxDurationMs as computeMaxDurationMs } from "../call-duration.js";
import { MAX_CALL_DURATION_CAP_S } from "../store/defaults.js";
import { elevenLabsHangUpAction, hangUpForCall, persistEndWithReason } from "./call-termination.js";
import { carrierEndMsOf } from "../store/state-ops.js";
import { makeBudgetWatchdog } from "./budget-watchdog.js";
import { defaultSetTimer } from "../utils/timer.js";

export const CAP_FAILURE_REASON = "max-duration-cap";

export const BUDGET_FAILURE_REASON = "budget-exhausted";

export const BUDGET_TERMINATION_ORIGIN = Object.freeze({
  REATTACH: "re-attach",
  WATCHDOG: "wache",
});

const ACTIVE_CALL_STATUS = "active";

function callMaxDurationMs(call) {
  return computeMaxDurationMs(call, MAX_CALL_DURATION_CAP_S);
}

function runningLeg(call) {
  return call?.status === ACTIVE_CALL_STATUS ? call : null;
}

function activeCallsOf(store) {
  return store.load().calls.filter((call) => call.status === ACTIVE_CALL_STATUS);
}

function makeBudgetAxisSeam({
  store, billing, blockingBudgetAxis, terminateActiveCall, intervalMs, setTimer,
}) {
  function blockingAxisFor(call) {
    return blockingBudgetAxis({ store, billing, tenantId: call.tenantId });
  }

  async function terminateOverBudgetCall({ callId, providerCallSid, origin }) {
    console.warn(`[budget] ${origin}: Guthaben erschoepft (call=${callId}) -> terminalisiert`);
    await terminateActiveCall({
      callId, providerCallSid, status: "completed", failureReason: BUDGET_FAILURE_REASON,
    });
  }

  const watchdog = makeBudgetWatchdog({
    intervalMs,
    activeCallById: (callId) => runningLeg(store.getCall(callId)),
    blockingAxisFor,
    terminate: (call) =>
      terminateOverBudgetCall({
        callId: call.id,
        providerCallSid: call.twilioSid,
        origin: BUDGET_TERMINATION_ORIGIN.WATCHDOG,
      }),
    setTimer,
  });

  function rearmWatchdogs() {
    const { armedNow } = watchdog.rearm(activeCallsOf(store).map((call) => call.id));
    if (armedNow)
      console.log(
        `[budget] Boot-Re-Arm der Geld-Wache: ${armedNow} aktive Legs (Takt ${intervalMs} ms)`,
      );
  }

  return { blockingAxisFor, terminateOverBudgetCall, arm: watchdog.arm, rearmWatchdogs };
}

export function makeCallLifecycle({
  store,
  config,
  finishCall,
  releaseReserve,
  voiceControl,
  terminateAndBillCall,
  hangUpAction,
  billThunk, endActiveCall,
  awaitAndPersistInboundElResult,
  reattachActiveCallCore,
  cappedEndedAtMs,
  classifyCallTime,
  blockingBudgetAxis,
  setBudgetWatchTimer = defaultSetTimer,
}) {
  async function terminateActiveCall({ callId, providerCallSid, status, failureReason }) {
    try {
      const call = store.getCall(callId);
      if (call?.status !== "active") return;
      const endedAtIso = new Date(
        cappedEndedAtMs(call, carrierEndMsOf(call, Date.now()), MAX_CALL_DURATION_CAP_S),
      ).toISOString();
      await terminateAndBillCall({
        persistEnd: persistEndWithReason({
          store, callId, reason: failureReason,
          endCall: () => store.setCallEndedAt(callId, status, endedAtIso),
        }),
        hangUp: hangUpForCall({
          call,
          hangUp: hangUpAction(voiceControl, call, providerCallSid) ?? elevenLabsHangUpAction(endActiveCall, call),
          awaitAndPersistInboundElResult,
        }),
        bill: billThunk(finishCall, store, callId),
        callId,
      });
    } catch (err) {
      console.error("[max-duration] Terminalisierung fehlgeschlagen:", err.message);
    }
  }

  async function terminateCappedCall(callId, providerCallSid, status) {
    await terminateActiveCall({ callId, providerCallSid, status, failureReason: CAP_FAILURE_REASON });
  }

  const budgetAxis = makeBudgetAxisSeam({
    store, billing: config.billing, blockingBudgetAxis, terminateActiveCall,
    intervalMs: config.safety.budgetWatchdogIntervalMs, setTimer: setBudgetWatchTimer,
  });

  function scheduleMaxDurationEnd(call, providerCallSid, ms) {
    setTimeout(() => void terminateCappedCall(call.id, providerCallSid, "completed"), ms);
  }

  function armMaxDurationTimer(call, providerCallSid) {
    scheduleMaxDurationEnd(call, providerCallSid, callMaxDurationMs(call));
    budgetAxis.arm(call.id);
  }

  function armReserveReleaseTimer(call) {
    const delay = callMaxDurationMs(call) + config.safety.reserveReleaseGraceMs;
    setTimeout(() => releaseReserve(store.getCall(call.id) || call), delay);
  }

  async function reattachActiveCall(callId) {
    const result = await reattachActiveCallCore(callId, {
      attachActiveCall: store.attachActiveCall,
      maxCallDurationS: MAX_CALL_DURATION_CAP_S,
      terminateCappedCall, scheduleMaxDurationEnd,
      budgetAxisFor: budgetAxis.blockingAxisFor,
      terminateOverBudgetCall: (id, providerCallSid) =>
        budgetAxis.terminateOverBudgetCall({
          callId: id, providerCallSid, origin: BUDGET_TERMINATION_ORIGIN.REATTACH,
        }),
    });
    if (result.call) budgetAxis.arm(result.call.id);
    return result;
  }

  function rearmActiveCallTimers() {
    const nowMs = Date.now();
    let reArmed = 0;
    let terminalized = 0;
    for (const call of activeCallsOf(store)) {
      const { remaining, expired } = classifyCallTime(call, nowMs, MAX_CALL_DURATION_CAP_S);
      if (expired) {
        void terminateCappedCall(call.id, call.twilioSid, "failed");
        terminalized++;
      } else {
        scheduleMaxDurationEnd(call, call.twilioSid, remaining);
        reArmed++;
      }
    }
    if (reArmed || terminalized)
      console.log(`[rearm] aktive Calls beim Boot: ${reArmed} re-armed, ${terminalized} terminalisiert (Zombie)`);
  }

  return {
    armMaxDurationTimer, armReserveReleaseTimer,
    reattachActiveCall,
    rearmActiveCallTimers,
    rearmBudgetWatchdogs: budgetAxis.rearmWatchdogs,
  };
}

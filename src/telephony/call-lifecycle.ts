import { callMaxDurationMs as computeMaxDurationMs } from "../call-duration.ts";
import { MAX_CALL_DURATION_CAP_S } from "../begriffe/anrufe.js";
import { elevenLabsHangUpAction, hangUpForCall, persistEndWithReason } from "./call-termination.ts";
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

const carrierEndMs: (call: Call, nowMs: number) => number = carrierEndMsOf;

interface Call {
  id: string;
  status: string;
  tenantId: string;
  twilioSid: string;
}

interface Store {
  load: () => { calls: Call[] };
  getCall: (callId: string) => Call | null | undefined;
  setCallEndedAt: (callId: string, status: string, endedAtIso: string) => unknown;
  recordFailureReason: (callId: string, reason: string) => unknown;
  attachActiveCall: (callId: string) => Promise<Call | null | undefined>;
}

type SetTimer = (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
type HangUp = (() => Promise<unknown>) | null | undefined;

interface TerminateRequest {
  callId: string;
  providerCallSid: string;
  status: string;
  failureReason: string;
}

type TerminateActiveCall = (request: TerminateRequest) => Promise<void>;
type BlockingBudgetAxis = (query: { store: Store; billing: unknown; tenantId: string }) => unknown;

interface BudgetAxisSeamDeps {
  store: Store;
  billing: unknown;
  blockingBudgetAxis: BlockingBudgetAxis;
  terminateActiveCall: TerminateActiveCall;
  intervalMs: number;
  setTimer: SetTimer;
}

interface ReattachResult {
  call?: Call | null;
}

interface CallLifecycleDeps {
  store: Store;
  config: {
    billing: unknown;
    safety: { budgetWatchdogIntervalMs: number; reserveReleaseGraceMs: number };
  };
  finishCall: unknown;
  releaseReserve: (call: Call) => unknown;
  voiceControl: unknown;
  terminateAndBillCall: (request: {
    persistEnd: () => void;
    hangUp: HangUp;
    bill: () => unknown;
    callId: string;
  }) => Promise<void>;
  hangUpAction: (voiceControl: unknown, call: Call, providerCallSid: string) => HangUp;
  billThunk: (finishCall: unknown, store: Store, callId: string) => () => unknown;
  endActiveCall: ((callId: string) => Promise<unknown>) | null | undefined;
  awaitAndPersistInboundElResult: (callId: string) => Promise<unknown>;
  reattachActiveCallCore: (callId: string, options: Record<string, unknown>) => Promise<ReattachResult>;
  cappedEndedAtMs: (call: Call, carrierEndMs: number, capS: number) => number;
  classifyCallTime: (call: Call, nowMs: number, capS: number) => { remaining: number; expired: boolean };
  blockingBudgetAxis: BlockingBudgetAxis;
  setBudgetWatchTimer?: SetTimer;
}

interface CallLifecycle {
  armMaxDurationTimer: (call: Call, providerCallSid: string) => void;
  armReserveReleaseTimer: (call: Call) => void;
  reattachActiveCall: (callId: string) => Promise<ReattachResult>;
  rearmActiveCallTimers: () => void;
  rearmBudgetWatchdogs: () => void;
}

function callMaxDurationMs(call: Call): number {
  return computeMaxDurationMs(call, MAX_CALL_DURATION_CAP_S);
}

function runningLeg(call: Call | null | undefined): Call | null {
  return call?.status === ACTIVE_CALL_STATUS ? call : null;
}

function activeCallsOf(store: Store): Call[] {
  return store.load().calls.filter((call) => call.status === ACTIVE_CALL_STATUS);
}

function makeBudgetAxisSeam({
  store, billing, blockingBudgetAxis, terminateActiveCall, intervalMs, setTimer,
}: BudgetAxisSeamDeps) {
  function blockingAxisFor(call: Call): unknown {
    return blockingBudgetAxis({ store, billing, tenantId: call.tenantId });
  }

  async function terminateOverBudgetCall(
    { callId, providerCallSid, origin }: { callId: string; providerCallSid: string; origin: string },
  ): Promise<void> {
    console.warn(`[budget] ${origin}: Guthaben erschoepft (call=${callId}) -> terminalisiert`);
    await terminateActiveCall({
      callId, providerCallSid, status: "completed", failureReason: BUDGET_FAILURE_REASON,
    });
  }

  const watchdog = makeBudgetWatchdog({
    intervalMs,
    activeCallById: (callId: string) => runningLeg(store.getCall(callId)),
    blockingAxisFor,
    terminate: (call: Call) =>
      terminateOverBudgetCall({
        callId: call.id,
        providerCallSid: call.twilioSid,
        origin: BUDGET_TERMINATION_ORIGIN.WATCHDOG,
      }),
    setTimer,
  });

  function rearmWatchdogs(): void {
    const { armedNow } = watchdog.rearm(activeCallsOf(store).map((call) => call.id));
    if (armedNow)
      console.log(
        `[budget] Boot-Re-Arm der Geld-Wache: ${String(armedNow)} aktive Legs (Takt ${String(intervalMs)} ms)`,
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
}: CallLifecycleDeps): CallLifecycle {
  async function terminateActiveCall({ callId, providerCallSid, status, failureReason }: TerminateRequest): Promise<void> {
    try {
      const call = store.getCall(callId);
      if (call?.status !== "active") return;
      const endedAtIso = new Date(
        cappedEndedAtMs(call, carrierEndMs(call, Date.now()), MAX_CALL_DURATION_CAP_S),
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
      console.error("[max-duration] Terminalisierung fehlgeschlagen:", Reflect.get(Object(err), "message"));
    }
  }

  async function terminateCappedCall(callId: string, providerCallSid: string, status: string): Promise<void> {
    await terminateActiveCall({ callId, providerCallSid, status, failureReason: CAP_FAILURE_REASON });
  }

  const budgetAxis = makeBudgetAxisSeam({
    store, billing: config.billing, blockingBudgetAxis, terminateActiveCall,
    intervalMs: config.safety.budgetWatchdogIntervalMs, setTimer: setBudgetWatchTimer,
  });

  function scheduleMaxDurationEnd(call: Call, providerCallSid: string, ms: number): void {
    setTimeout(() => {
      terminateCappedCall(call.id, providerCallSid, "completed").catch(() => undefined);
    }, ms);
  }

  function armMaxDurationTimer(call: Call, providerCallSid: string): void {
    scheduleMaxDurationEnd(call, providerCallSid, callMaxDurationMs(call));
    budgetAxis.arm(call.id);
  }

  function armReserveReleaseTimer(call: Call): void {
    const delay = callMaxDurationMs(call) + config.safety.reserveReleaseGraceMs;
    setTimeout(() => releaseReserve(store.getCall(call.id) ?? call), delay);
  }

  async function reattachActiveCall(callId: string): Promise<ReattachResult> {
    const result = await reattachActiveCallCore(callId, {
      attachActiveCall: store.attachActiveCall,
      maxCallDurationS: MAX_CALL_DURATION_CAP_S,
      terminateCappedCall, scheduleMaxDurationEnd,
      budgetAxisFor: budgetAxis.blockingAxisFor,
      terminateOverBudgetCall: (id: string, providerCallSid: string) =>
        budgetAxis.terminateOverBudgetCall({
          callId: id, providerCallSid, origin: BUDGET_TERMINATION_ORIGIN.REATTACH,
        }),
    });
    if (result.call) budgetAxis.arm(result.call.id);
    return result;
  }

  function rearmActiveCallTimers(): void {
    const nowMs = Date.now();
    let reArmed = 0;
    let terminalized = 0;
    for (const call of activeCallsOf(store)) {
      const { remaining, expired } = classifyCallTime(call, nowMs, MAX_CALL_DURATION_CAP_S);
      if (expired) {
        terminateCappedCall(call.id, call.twilioSid, "failed").catch(() => undefined);
        terminalized++;
      } else {
        scheduleMaxDurationEnd(call, call.twilioSid, remaining);
        reArmed++;
      }
    }
    if (reArmed || terminalized)
      console.log(`[rearm] aktive Calls beim Boot: ${String(reArmed)} re-armed, ${String(terminalized)} terminalisiert (Zombie)`);
  }

  return {
    armMaxDurationTimer, armReserveReleaseTimer,
    reattachActiveCall,
    rearmActiveCallTimers,
    rearmBudgetWatchdogs: budgetAxis.rearmWatchdogs,
  };
}

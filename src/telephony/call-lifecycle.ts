import { callMaxDurationMs as computeMaxDurationMs } from "../call-duration.ts";
import { MAX_CALL_DURATION_CAP_S, MAX_DURATION_RETRY_MS } from "../begriffe/anrufe.js";
import { elevenLabsHangUpAction, hangUpForCall, persistEndWithReason } from "./call-termination.ts";
import { carrierEndMsOf } from "../store/state-ops.js";
import { makeBudgetWatchdog } from "./budget-watchdog.js";
import { defaultSetTimer } from "../utils/timer.js";
import { inDatenbankBeendet } from "./reattach.ts";

export const CAP_FAILURE_REASON = "max-duration-cap";

export const BUDGET_FAILURE_REASON = "budget-exhausted";

export const BUDGET_TERMINATION_ORIGIN = Object.freeze({
  REATTACH: "re-attach",
  WATCHDOG: "wache",
});

const ACTIVE_CALL_STATUS = "active";

const EL_ENDE_FEHLER = "[fristen] EL-Konversation loeschen fehlgeschlagen:";

const LESE_FEHLER = "[max-duration] Anruf nicht lesbar, neuer Versuch geplant:";

const FRIST_FEHLER = "[fristen] Hoechstdauer-Frist schreiben fehlgeschlagen:";

const carrierEndMs: (call: Call, nowMs: number) => number = carrierEndMsOf;

interface Call {
  id: string;
  status: string;
  elevenlabsConversationId?: string | null;
  tenantId: string;
  twilioSid: string;
  maxDurationS?: number;
}

interface Store {
  load: () => { calls: Call[]; tenants: { id: string }[] };
  getCall: (callId: string) => Call | null | undefined;
  leseCall?: (callId: string) => Promise<Call | null | undefined>;
  activeCallsForSql?: (tenantId: string) => Promise<Call[]>;
  setCallEndedAt: (callId: string, status: string, endedAtIso: string) => unknown;
  recordFailureReason: (callId: string, reason: string) => unknown;
  attachActiveCall: (callId: string) => Promise<Call | null | undefined>;
  setzeHoechstdauerFrist?: (frist: { callId: string; tenantId: string; faelligAt: string }) => Promise<unknown>;
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
    persistEnd: () => unknown;
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
  rearmActiveCallTimers: () => void | Promise<void>;
  rearmBudgetWatchdogs: () => void | Promise<void>;
  terminateExpiredCall: (call: Call) => Promise<void>;
  terminateOverBudgetExpired: (call: Call) => Promise<void>;
  blockingAxisFor: (call: Call) => unknown;
}

function callMaxDurationMs(call: Call): number {
  return computeMaxDurationMs(call, MAX_CALL_DURATION_CAP_S);
}

function schreibeHoechstdauerFrist(store: Store, call: Call, ms: number): void {
  const faelligAt = new Date(Date.now() + ms).toISOString();
  Promise.resolve(store.setzeHoechstdauerFrist?.({ callId: call.id, tenantId: call.tenantId, faelligAt })).catch(
    (fehler: unknown) => {
      console.error(FRIST_FEHLER, call.id, String(fehler));
    },
  );
}

async function loescheElKonversation(call: Call, endActiveCall: CallLifecycleDeps["endActiveCall"]): Promise<void> {
  if (!call.elevenlabsConversationId || !endActiveCall) return;
  await endActiveCall(call.id).catch((fehler: unknown) => {
    console.error(EL_ENDE_FEHLER, call.id, Reflect.get(Object(fehler), "message"));
  });
}

async function loescheOhneAuflegeweg(
  call: Call,
  { hangUpAction, voiceControl, endActiveCall }: Pick<CallLifecycleDeps, "hangUpAction" | "voiceControl" | "endActiveCall">,
): Promise<void> {
  const weg = hangUpAction(voiceControl, call, call.twilioSid) ?? elevenLabsHangUpAction(endActiveCall, call);
  if (!weg) await loescheElKonversation(call, endActiveCall);
}

function runningLeg(call: Call | null | undefined): Call | null {
  return call?.status === ACTIVE_CALL_STATUS ? call : null;
}

function activeCallsOf(store: Store): Call[] {
  return store.load().calls.filter((call) => call.status === ACTIVE_CALL_STATUS);
}

function readCall(store: Store, callId: string): Promise<Call | null | undefined> | Call | null | undefined {
  return store.leseCall ? store.leseCall(callId) : store.getCall(callId);
}

async function readCallOrRetry(
  store: Store,
  callId: string,
  retry: () => void,
): Promise<{ call: Call | null | undefined } | null> {
  try {
    return { call: await readCall(store, callId) };
  } catch (err) {
    console.error(LESE_FEHLER, callId, Reflect.get(Object(err), "message"));
    setTimeout(retry, MAX_DURATION_RETRY_MS);
    return null;
  }
}

async function activeCallsFromDatabase(store: Store, activeCallsForSql: NonNullable<Store["activeCallsForSql"]>): Promise<Call[]> {
  const perTenant = await Promise.all(store.load().tenants.map((tenant) => activeCallsForSql(tenant.id)));
  return perTenant.flat();
}

function withActiveCalls(store: Store, use: (calls: Call[]) => void): void | Promise<void> {
  const { activeCallsForSql } = store;
  if (!activeCallsForSql) {
    use(activeCallsOf(store));
    return undefined;
  }
  return activeCallsFromDatabase(store, activeCallsForSql).then(use);
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
    activeCallById: async (callId: string) => runningLeg(await readCall(store, callId)),
    blockingAxisFor,
    terminate: (call: Call) =>
      terminateOverBudgetCall({
        callId: call.id,
        providerCallSid: call.twilioSid,
        origin: BUDGET_TERMINATION_ORIGIN.WATCHDOG,
      }),
    setTimer,
  });

  function rearmWatchdogs(): void | Promise<void> {
    return withActiveCalls(store, (calls) => {
      const { armedNow } = watchdog.rearm(calls.map((call) => call.id));
      if (armedNow)
        console.log(
          `[budget] Boot-Re-Arm der Geld-Wache: ${String(armedNow)} aktive Legs (Takt ${String(intervalMs)} ms)`,
        );
    });
  }

  return { blockingAxisFor, terminateOverBudgetCall, arm: watchdog.arm, rearmWatchdogs };
}

export function makeCallLifecycle({
  store, config, finishCall, releaseReserve, voiceControl, terminateAndBillCall, hangUpAction, billThunk,
  endActiveCall, awaitAndPersistInboundElResult, reattachActiveCallCore, cappedEndedAtMs, classifyCallTime,
  blockingBudgetAxis, setBudgetWatchTimer = defaultSetTimer,
}: CallLifecycleDeps): CallLifecycle {
  async function terminateActiveCall({ callId, providerCallSid, status, failureReason }: TerminateRequest): Promise<void> {
    try {
      const gelesen = await readCallOrRetry(store, callId, () => {
        terminateActiveCall({ callId, providerCallSid, status, failureReason }).catch(() => undefined);
      });
      if (!gelesen) return;
      const { call } = gelesen;
      if (call?.status !== "active") return;
      if (await inDatenbankBeendet(callId, store.attachActiveCall)) {
        await store.setCallEndedAt(callId, status, new Date().toISOString());
        return;
      }
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

  const ohneWeg = (call: Call) => loescheOhneAuflegeweg(call, { hangUpAction, voiceControl, endActiveCall });

  async function terminateExpiredCall(call: Call): Promise<void> {
    await ohneWeg(call);
    await terminateCappedCall(call.id, call.twilioSid, "failed");
  }

  async function terminateOverBudgetExpired(call: Call): Promise<void> {
    await ohneWeg(call);
    const { id: callId, twilioSid: providerCallSid } = call;
    await budgetAxis.terminateOverBudgetCall({ callId, providerCallSid, origin: BUDGET_TERMINATION_ORIGIN.WATCHDOG });
  }

  function scheduleMaxDurationEnd(call: Call, providerCallSid: string, ms: number): void {
    setTimeout(() => {
      terminateCappedCall(call.id, providerCallSid, "completed").catch(() => undefined);
    }, ms);
  }

  function armMaxDurationTimer(call: Call, providerCallSid: string): void {
    const ms = callMaxDurationMs(call);
    scheduleMaxDurationEnd(call, providerCallSid, ms);
    schreibeHoechstdauerFrist(store, call, ms);
    budgetAxis.arm(call.id);
  }

  function armReserveReleaseTimer(call: Call): void {
    const delay = callMaxDurationMs(call) + config.safety.reserveReleaseGraceMs;
    setTimeout(() => releaseReserve(store.getCall(call.id) ?? call), delay);
  }

  async function reattachActiveCall(callId: string): Promise<ReattachResult> {
    const result = await reattachActiveCallCore(callId, {
      attachActiveCall: store.attachActiveCall, maxCallDurationS: MAX_CALL_DURATION_CAP_S,
      terminateCappedCall, scheduleMaxDurationEnd,
      budgetAxisFor: budgetAxis.blockingAxisFor,
      terminateOverBudgetCall: (id: string, providerCallSid: string) =>
        budgetAxis.terminateOverBudgetCall({ callId: id, providerCallSid, origin: BUDGET_TERMINATION_ORIGIN.REATTACH }),
    });
    if (result.call) budgetAxis.arm(result.call.id);
    return result;
  }

  function rearmActiveCallTimers(): void | Promise<void> {
    return withActiveCalls(store, (calls) => {
      const nowMs = Date.now();
      let reArmed = 0;
      let terminalized = 0;
      for (const call of calls) {
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
    });
  }

  return {
    armMaxDurationTimer, armReserveReleaseTimer, reattachActiveCall, rearmActiveCallTimers,
    rearmBudgetWatchdogs: budgetAxis.rearmWatchdogs, terminateExpiredCall, terminateOverBudgetExpired,
    blockingAxisFor: budgetAxis.blockingAxisFor,
  };
}

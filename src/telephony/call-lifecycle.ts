import { callMaxDurationMs as computeMaxDurationMs } from "../call-duration.ts";
import { MAX_CALL_DURATION_CAP_S } from "../begriffe/anrufe.js";
import type { AnrufZustand } from "../begriffe/anruf-zustand.ts";
import { elevenLabsHangUpAction, hangUpForCall, persistEndWithReason } from "./call-termination.ts";
import { carrierEndMsOf } from "../store/state-ops.js";
import { inDatenbankBeendet } from "./reattach.ts";

export const CAP_FAILURE_REASON = "max-duration-cap";

export const BUDGET_FAILURE_REASON = "budget-exhausted";

export const BUDGET_TERMINATION_ORIGIN = Object.freeze({
  REATTACH: "re-attach",
  WATCHDOG: "wache",
});

const ACTIVE_CALL_STATUS: AnrufZustand = "active";

const EL_ENDE_FEHLER = "[fristen] EL-Konversation loeschen fehlgeschlagen:";

const LESE_FEHLER = "[max-duration] Anruf nicht lesbar:";

const FRIST_FEHLER = "[fristen] Hoechstdauer-Frist schreiben fehlgeschlagen:";

const RESERVE_FRIST_FEHLER = "[fristen] Reserve-Frist schreiben fehlgeschlagen:";

const carrierEndMs: (call: Call, nowMs: number) => number = carrierEndMsOf;

interface Call {
  id: string;
  status: AnrufZustand;
  elevenlabsConversationId?: string | null;
  tenantId: string;
  twilioSid: string;
  maxDurationS?: number;
}

interface FristEintrag {
  callId: string;
  tenantId: string;
  faelligAt: string;
}

type FristSchreiber = (frist: FristEintrag) => Promise<unknown>;

interface Store {
  load: () => { calls: Call[] };
  getCall: (callId: string) => Call | null | undefined;
  leseCall?: (callId: string) => Promise<Call | null | undefined>;
  setCallEndedAt: (callId: string, status: AnrufZustand, endedAtIso: string) => unknown;
  recordFailureReason: (callId: string, reason: string) => unknown;
  attachActiveCall: (callId: string) => Promise<Call | null | undefined>;
  setzeHoechstdauerFrist?: FristSchreiber;
  setzeReserveFrist?: FristSchreiber;
}

type HangUp = (() => Promise<unknown>) | null | undefined;

interface TerminateRequest {
  callId: string;
  providerCallSid: string;
  status: AnrufZustand;
  failureReason: string;
}

type TerminateActiveCall = (request: TerminateRequest) => Promise<void>;
type BlockingBudgetAxis = (query: { store: Store; billing: unknown; tenantId: string }) => unknown;

interface BudgetAxisSeamDeps {
  store: Store;
  billing: unknown;
  blockingBudgetAxis: BlockingBudgetAxis;
  terminateActiveCall: TerminateActiveCall;
}

interface ReattachResult {
  call?: Call | null;
}

interface CallLifecycleDeps {
  store: Store;
  config: {
    billing: unknown;
    safety: { reserveReleaseGraceMs: number };
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
}

interface CallLifecycle {
  armMaxDurationTimer: (call: Call, providerCallSid: string) => void;
  armReserveReleaseTimer: (call: Call) => void;
  reattachActiveCall: (callId: string) => Promise<ReattachResult>;
  terminateExpiredCall: (call: Call) => Promise<void>;
  terminateOverBudgetExpired: (call: Call) => Promise<void>;
  blockingAxisFor: (mandant: { tenantId: string }) => unknown;
  releaseReserve: (call: Call) => unknown;
  abgelaufeneAktive: () => Call[];
}

function callMaxDurationMs(call: Call): number {
  return computeMaxDurationMs(call, MAX_CALL_DURATION_CAP_S);
}

interface FristZiel {
  schreibe: (frist: FristEintrag) => Promise<unknown> | undefined;
  fehlerText: string;
}

function schreibeFrist({ schreibe, fehlerText }: FristZiel, call: Call, ms: number): void {
  const faelligAt = new Date(Date.now() + ms).toISOString();
  Promise.resolve(schreibe({ callId: call.id, tenantId: call.tenantId, faelligAt })).catch((fehler: unknown) => {
    console.error(fehlerText, call.id, String(fehler));
  });
}

function planeReserveFreigabe({ store }: Pick<CallLifecycleDeps, "store">, call: Call, delayMs: number): void {
  schreibeFrist({ schreibe: (frist) => store.setzeReserveFrist?.(frist), fehlerText: RESERVE_FRIST_FEHLER }, call, delayMs);
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

function activeCallsOf(store: Store): Call[] {
  return store.load().calls.filter((call) => call.status === ACTIVE_CALL_STATUS);
}

function abgelaufeneVon(store: Store, classifyCallTime: CallLifecycleDeps["classifyCallTime"]): Call[] {
  const nowMs = Date.now();
  return activeCallsOf(store).filter((call) => classifyCallTime(call, nowMs, MAX_CALL_DURATION_CAP_S).expired);
}

function readCall(store: Store, callId: string): Promise<Call | null | undefined> | Call | null | undefined {
  return store.leseCall ? store.leseCall(callId) : store.getCall(callId);
}

async function readCallOrNull(store: Store, callId: string): Promise<{ call: Call | null | undefined } | null> {
  try {
    return { call: await readCall(store, callId) };
  } catch (err) {
    console.error(LESE_FEHLER, callId, Reflect.get(Object(err), "message"));
    return null;
  }
}

function makeBudgetAxisSeam({
  store, billing, blockingBudgetAxis, terminateActiveCall,
}: BudgetAxisSeamDeps) {
  function blockingAxisFor({ tenantId }: { tenantId: string }): unknown {
    return blockingBudgetAxis({ store, billing, tenantId });
  }

  async function terminateOverBudgetCall(
    { callId, providerCallSid, origin }: { callId: string; providerCallSid: string; origin: string },
  ): Promise<void> {
    console.warn(`[budget] ${origin}: Guthaben erschoepft (call=${callId}) -> terminalisiert`);
    await terminateActiveCall({
      callId, providerCallSid, status: "completed", failureReason: BUDGET_FAILURE_REASON,
    });
  }

  return { blockingAxisFor, terminateOverBudgetCall };
}

async function beendeUeberBudgetOhneWeg(
  call: Call,
  ohneWeg: (call: Call) => Promise<void>,
  { terminateOverBudgetCall }: Pick<ReturnType<typeof makeBudgetAxisSeam>, "terminateOverBudgetCall">,
): Promise<void> {
  await ohneWeg(call);
  const { id: callId, twilioSid: providerCallSid } = call;
  await terminateOverBudgetCall({ callId, providerCallSid, origin: BUDGET_TERMINATION_ORIGIN.WATCHDOG });
}

export function makeCallLifecycle({
  store, config, finishCall, releaseReserve, voiceControl, terminateAndBillCall, hangUpAction, billThunk,
  endActiveCall, awaitAndPersistInboundElResult, reattachActiveCallCore, cappedEndedAtMs, classifyCallTime,
  blockingBudgetAxis,
}: CallLifecycleDeps): CallLifecycle {
  async function terminateActiveCall({ callId, providerCallSid, status, failureReason }: TerminateRequest): Promise<void> {
    try {
      const gelesen = await readCallOrNull(store, callId);
      if (!gelesen) return;
      const { call } = gelesen;
      if (call?.status !== "active") return;
      if (await inDatenbankBeendet(callId, store.attachActiveCall)) {
        await persistEndWithReason({
          store, callId, reason: failureReason,
          endCall: () => store.setCallEndedAt(callId, status, new Date().toISOString()),
        })();
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

  async function terminateCappedCall(callId: string, providerCallSid: string, status: AnrufZustand): Promise<void> {
    await terminateActiveCall({ callId, providerCallSid, status, failureReason: CAP_FAILURE_REASON });
  }

  const budgetAxis = makeBudgetAxisSeam({
    store, billing: config.billing, blockingBudgetAxis, terminateActiveCall,
  });

  const ohneWeg = (call: Call) => loescheOhneAuflegeweg(call, { hangUpAction, voiceControl, endActiveCall });

  const prozessStartMs = Date.now();

  async function terminateExpiredCall(call: Call): Promise<void> {
    await ohneWeg(call);
    const zombie = classifyCallTime(call, prozessStartMs, MAX_CALL_DURATION_CAP_S).expired;
    await terminateCappedCall(call.id, call.twilioSid, zombie ? "failed" : "completed");
  }

  const terminateOverBudgetExpired = (call: Call) => beendeUeberBudgetOhneWeg(call, ohneWeg, budgetAxis);

  function scheduleMaxDurationEnd(call: Call, providerCallSid: string, ms: number): void {
    schreibeFrist({ schreibe: (frist) => store.setzeHoechstdauerFrist?.(frist), fehlerText: FRIST_FEHLER }, call, ms);
  }

  function armMaxDurationTimer(call: Call, providerCallSid: string): void {
    scheduleMaxDurationEnd(call, providerCallSid, callMaxDurationMs(call));
  }

  function armReserveReleaseTimer(call: Call): void {
    planeReserveFreigabe({ store }, call, callMaxDurationMs(call) + config.safety.reserveReleaseGraceMs);
  }

  async function reattachActiveCall(callId: string): Promise<ReattachResult> {
    const result = await reattachActiveCallCore(callId, {
      attachActiveCall: store.attachActiveCall, maxCallDurationS: MAX_CALL_DURATION_CAP_S,
      terminateCappedCall, scheduleMaxDurationEnd,
      budgetAxisFor: budgetAxis.blockingAxisFor,
      terminateOverBudgetCall: (id: string, providerCallSid: string) =>
        budgetAxis.terminateOverBudgetCall({ callId: id, providerCallSid, origin: BUDGET_TERMINATION_ORIGIN.REATTACH }),
    });
    return result;
  }

  return {
    abgelaufeneAktive: () => abgelaufeneVon(store, classifyCallTime), armMaxDurationTimer, armReserveReleaseTimer, reattachActiveCall,
    terminateExpiredCall, terminateOverBudgetExpired,
    blockingAxisFor: budgetAxis.blockingAxisFor, releaseReserve,
  };
}

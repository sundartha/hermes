import { defaultSetTimer } from "../utils/timer.js";

interface WatchdogDeps<Call> {
  intervalMs: number;
  activeCallById: (callId: string) => Call | null | undefined;
  blockingAxisFor: (call: Call) => unknown;
  terminate: (call: Call) => Promise<unknown>;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

export function makeBudgetWatchdog<Call>({
  intervalMs,
  activeCallById,
  blockingAxisFor,
  terminate,
  setTimer = defaultSetTimer,
}: WatchdogDeps<Call>): { arm: (callId: string) => void; rearm: (callIds: Iterable<string>) => { armedNow: number } } {
  const enabled = Number.isFinite(intervalMs) && intervalMs > 0;
  const armed = new Set();

  function schedule(callId: string): void {
    setTimer(() => {
      void tick(callId).catch((err: unknown) => {
        onTickFailure(callId, err);
      });
    }, intervalMs);
  }

  function onTickFailure(callId: string, err: unknown): void {
    console.error(`[budget] Geld-Wache: Runde fehlgeschlagen (call=${callId}): ${err instanceof Error ? err.message : String(err)}`);
    if (armed.has(callId)) schedule(callId);
  }

  async function tick(callId: string): Promise<void> {
    if (!armed.has(callId)) return;
    const call = activeCallById(callId);
    if (!call) {
      armed.delete(callId);
      return;
    }
    if (!blockingAxisFor(call)) {
      schedule(callId);
      return;
    }
    armed.delete(callId);
    await terminate(call);
  }

  function arm(callId: string): void {
    if (!enabled || armed.has(callId)) return;
    armed.add(callId);
    schedule(callId);
  }

  function rearm(callIds: Iterable<string>): { armedNow: number } {
    const before = armed.size;
    for (const callId of callIds) arm(callId);
    return { armedNow: armed.size - before };
  }

  return { arm, rearm };
}

import { MS_PER_MINUTE } from "../../../utils/timer.js";

const MINUTE_WINDOW_MS = MS_PER_MINUTE;

const timerSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface ThrottleOptions {   budget: number; now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
}

interface MinuteWindowThrottle {
  reserveSlot: () => Promise<void>;
  waitForWindowReset: (hintMs?: number | null) => Promise<void>;
}

export function createMinuteWindowThrottle({ budget, now = Date.now, sleep = timerSleep }: ThrottleOptions): MinuteWindowThrottle {
  if (!Number.isInteger(budget) || budget < 1)
    throw new Error("createMinuteWindowThrottle: budget muss eine positive Ganzzahl sein");

  let windowStartMs: number | null = null;
  let usedInWindow = 0;

  const windowStartOf = (nowMs: number): number => Math.floor(nowMs / MINUTE_WINDOW_MS) * MINUTE_WINDOW_MS;
  const msUntilNextWindow = (nowMs: number): number => windowStartOf(nowMs) + MINUTE_WINDOW_MS - nowMs;

  function syncWindow(nowMs: number): void {
    const start = windowStartOf(nowMs);
    if (start === windowStartMs) return;
    windowStartMs = start;
    usedInWindow = 0;
  }

  function waitMsFor(hintMs: number | null | undefined, nowMs: number): number {
    if (hintMs === null || hintMs === undefined) return msUntilNextWindow(nowMs);
    return Math.min(Math.max(hintMs, 0), MINUTE_WINDOW_MS);
  }

  return {
    async reserveSlot(): Promise<void> {
      syncWindow(now());
      if (usedInWindow >= budget) {
        await sleep(msUntilNextWindow(now()));
        syncWindow(now());
      }
      usedInWindow += 1;
    },

    async waitForWindowReset(hintMs: number | null = null): Promise<void> {
      await sleep(waitMsFor(hintMs, now()));
    },
  };
}

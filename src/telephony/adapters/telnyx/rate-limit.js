const MINUTE_WINDOW_MS = 60_000;

const timerSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createMinuteWindowThrottle({ budget, now = Date.now, sleep = timerSleep }) {
  if (!Number.isInteger(budget) || budget < 1)
    throw new Error("createMinuteWindowThrottle: budget muss eine positive Ganzzahl sein");

  let windowStartMs = null;
  let usedInWindow = 0;

  const windowStartOf = (nowMs) => Math.floor(nowMs / MINUTE_WINDOW_MS) * MINUTE_WINDOW_MS;
  const msUntilNextWindow = (nowMs) => windowStartOf(nowMs) + MINUTE_WINDOW_MS - nowMs;

  function syncWindow(nowMs) {
    const start = windowStartOf(nowMs);
    if (start === windowStartMs) return;
    windowStartMs = start;
    usedInWindow = 0;
  }

  function waitMsFor(hintMs, nowMs) {
    if (hintMs === null || hintMs === undefined) return msUntilNextWindow(nowMs);
    return Math.min(Math.max(hintMs, 0), MINUTE_WINDOW_MS);
  }

  return {
    async reserveSlot() {
      syncWindow(now());
      if (usedInWindow >= budget) {
        await sleep(msUntilNextWindow(now()));
        syncWindow(now());
      }
      usedInWindow += 1;
    },

    async waitForWindowReset(hintMs = null) {
      await sleep(waitMsFor(hintMs, now()));
    },
  };
}

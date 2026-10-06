export function jumpClock(start) {
  const startMs = typeof start === "string" ? Date.parse(start) : start;
  let nowMs = startMs;
  const sleeps = [];
  return {
    now: () => nowMs,
    sleep: async (ms) => {
      sleeps.push(ms);
      nowMs += ms;
    },
    sleeps,
    elapsedMs: () => nowMs - startMs,
  };
}

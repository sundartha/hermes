export function makeBudgetWatchdog({
  intervalMs,
  activeCallById,
  blockingAxisFor,
  terminate,
  setTimer,
}) {
  const enabled = Number.isFinite(intervalMs) && intervalMs > 0;
  const armed = new Set();

  function schedule(callId) {
    setTimer(() => {
      void tick(callId).catch((err) => onTickFailure(callId, err));
    }, intervalMs);
  }

  function onTickFailure(callId, err) {
    console.error(`[budget] Geld-Wache: Runde fehlgeschlagen (call=${callId}): ${err.message}`);
    if (armed.has(callId)) schedule(callId);
  }

  async function tick(callId) {
    if (!armed.has(callId)) return;
    const call = await activeCallById(callId);
    if (!call) {
      armed.delete(callId);
      return;
    }
    if (!(await blockingAxisFor(call))) {
      schedule(callId);
      return;
    }
    armed.delete(callId);
    await terminate(call);
  }

  function arm(callId) {
    if (!enabled || armed.has(callId)) return;
    armed.add(callId);
    schedule(callId);
  }

  return { arm };
}

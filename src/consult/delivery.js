export const CONSULT_POLL_HOLD_MS = 22000;
export const CONSULT_POLL_TICK_MS = 250;
export const CONSULT_POLL_ABORT_MARGIN_MS = 3000;
export const CONSULT_POLL_ABORT_MS = CONSULT_POLL_HOLD_MS + CONSULT_POLL_ABORT_MARGIN_MS;
export const MAX_OPEN_POLLS_PER_CALL = 2;
export const MAX_OPEN_POLLS_PER_TENANT = 4;

export const CONSULT_EVENT = Object.freeze({ CONSULT: "consult", DONE: "done", NONE: "none" });

const NO_SLOT = Object.freeze({ granted: false, value: null });

const NO_EVENT = Object.freeze({ event: CONSULT_EVENT.NONE, eventId: null, questions: [] });
const DONE_EVENT = Object.freeze({ event: CONSULT_EVENT.DONE, eventId: null, questions: [] });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bump(counter, key, delta) {
  const next = (counter.get(key) || 0) + delta;
  if (next <= 0) counter.delete(key);
  else counter.set(key, next);
  return next;
}

export function makeConsultDelivery({
  store,
  holdMs = CONSULT_POLL_HOLD_MS,
  tickMs = CONSULT_POLL_TICK_MS,
}) {
  const pollsPerCall = new Map();
  const pollsPerTenant = new Map();
  let draining = false;

  function claimSlot(callId, tenantId) {
    const callOpen = pollsPerCall.get(callId) || 0;
    const tenantOpen = pollsPerTenant.get(tenantId) || 0;
    if (callOpen >= MAX_OPEN_POLLS_PER_CALL || tenantOpen >= MAX_OPEN_POLLS_PER_TENANT)
      return false;
    bump(pollsPerCall, callId, 1);
    bump(pollsPerTenant, tenantId, 1);
    return true;
  }

  function freeSlot(callId, tenantId) {
    bump(pollsPerCall, callId, -1);
    bump(pollsPerTenant, tenantId, -1);
  }

  function currentEvent(callId, afterEventId) {
    const consult = store.pendingConsult(callId, afterEventId);
    if (consult)
      return {
        event: CONSULT_EVENT.CONSULT,
        eventId: consult.id,
        questions: consult.questions,
      };
    const call = store.getCall(callId);
    return call && call.status !== "active" ? DONE_EVENT : NO_EVENT;
  }

  async function waitForEvent({ callId, tenantId, afterEventId, signal }) {
    if (!claimSlot(callId, tenantId)) return NO_EVENT;
    const deadline = Date.now() + holdMs;
    try {
      for (;;) {
        const event = currentEvent(callId, afterEventId);
        if (event.event !== CONSULT_EVENT.NONE) return event;
        if (draining || signal?.aborted || Date.now() >= deadline) return NO_EVENT;
        await sleep(tickMs);
      }
    } finally {
      freeSlot(callId, tenantId);
    }
  }

  async function withOpenSlot(callId, tenantId, run) {
    if (!claimSlot(callId, tenantId)) return NO_SLOT;
    try {
      return { granted: true, value: await run() };
    } finally {
      freeSlot(callId, tenantId);
    }
  }

  return {
    waitForEvent,
    withOpenSlot,
    releaseOpenPolls() {
      draining = true;
    },
    isDraining: () => draining,
    openPollCount: (callId) => pollsPerCall.get(callId) || 0,
  };
}

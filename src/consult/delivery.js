import { makeKonsultPlaetze } from "../utils/konsult-plaetze.js";

export const CONSULT_POLL_HOLD_MS = 22000;
export const CONSULT_POLL_TICK_MS = 250;
export const CONSULT_POLL_ABORT_MARGIN_MS = 3000;
export const CONSULT_POLL_ABORT_MS = CONSULT_POLL_HOLD_MS + CONSULT_POLL_ABORT_MARGIN_MS;
export const CONSULT_DONE_SUMMARY_WAIT_MS = 15000;
export const MAX_OPEN_POLLS_PER_CALL = 2;
export const MAX_OPEN_POLLS_PER_TENANT = 4;

export const CONSULT_EVENT = Object.freeze({ CONSULT: "consult", DONE: "done", NONE: "none" });

const NO_SLOT = Object.freeze({ granted: false, value: null });

const NO_EVENT = Object.freeze({ event: CONSULT_EVENT.NONE, eventId: null, questions: [] });
const DONE_EVENT = Object.freeze({ event: CONSULT_EVENT.DONE, eventId: null, questions: [] });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function makeConsultDelivery({
  store,
  konsultPlaetze = store.konsultPlaetze ?? makeKonsultPlaetze(),
  holdMs = CONSULT_POLL_HOLD_MS,
  tickMs = CONSULT_POLL_TICK_MS,
  summaryWaitMs = CONSULT_DONE_SUMMARY_WAIT_MS,
}) {
  let draining = false;

  const claimSlot = (callId, tenantId) =>
    konsultPlaetze.belegen({
      callId,
      tenantId,
      jeAnruf: MAX_OPEN_POLLS_PER_CALL,
      jeMandant: MAX_OPEN_POLLS_PER_TENANT,
      haltefristMs: holdMs + CONSULT_POLL_ABORT_MARGIN_MS,
    });

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

  function awaitsSummary(callId) {
    const call = store.getCall(callId);
    if (call?.status !== "completed" || call.summary || !call.transcript?.length) return false;
    return store.tenantContext(call.tenantId).settings.allowSummaries === true;
  }

  function summaryWait() {
    let until = null;
    return (callId, event) => {
      if (event.event !== CONSULT_EVENT.DONE || draining) return false;
      if (!awaitsSummary(callId)) return false;
      until ??= Date.now() + summaryWaitMs;
      return Date.now() < until;
    };
  }

  async function waitForEvent({ callId, tenantId, afterEventId, signal }) {
    const platzId = await claimSlot(callId, tenantId);
    if (platzId === null) return NO_EVENT;
    const deadline = Date.now() + holdMs;
    const summaryPending = summaryWait();
    try {
      for (;;) {
        const event = currentEvent(callId, afterEventId);
        if (event.event !== CONSULT_EVENT.NONE && !summaryPending(callId, event)) return event;
        if (draining || signal?.aborted || Date.now() >= deadline) return NO_EVENT;
        await sleep(tickMs);
      }
    } finally {
      await konsultPlaetze.freigeben(platzId);
    }
  }

  async function withOpenSlot(callId, tenantId, run) {
    const platzId = await claimSlot(callId, tenantId);
    if (platzId === null) return NO_SLOT;
    try {
      return { granted: true, value: await run() };
    } finally {
      await konsultPlaetze.freigeben(platzId);
    }
  }

  return {
    waitForEvent,
    withOpenSlot,
    releaseOpenPolls() {
      draining = true;
    },
    isDraining: () => draining,
    openPollCount: (callId) => konsultPlaetze.offenJeAnruf(callId),
  };
}

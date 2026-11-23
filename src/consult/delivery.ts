import { makeKonsultPlaetze } from "../utils/konsult-plaetze.js";

interface KonsultPlaetze {
  belegen(anfrage: {
    callId: string;
    tenantId: string;
    jeAnruf: number;
    jeMandant: number;
    haltefristMs: number;
  }): Promise<number | null>;
  freigeben(platzId: number): Promise<void>;
  offenJeAnruf(callId: string): number;
}

interface Rueckfrage {
  id: string;
  questions: unknown[];
}

interface RueckfrageStand {
  consult: Rueckfrage | null | undefined;
  status: string | null;
}

type RueckfrageLeser = (
  callId: string,
  tenantId: string,
  afterEventId: string | null | undefined,
) => Promise<RueckfrageStand>;

interface AnrufSicht {
  status?: string;
  summary?: unknown;
  transcript?: unknown[];
  tenantId: string;
}

interface ZustellSpeicher {
  pendingConsult(
    callId: string,
    afterEventId: string | null | undefined,
  ): Rueckfrage | null | undefined;
  leseCallUngebunden(callId: string): Promise<AnrufSicht | null | undefined>;
  tenantContext(tenantId: string): { settings: { allowSummaries?: unknown } };
  konsultPlaetze?: KonsultPlaetze;
  rueckfrageGelesen?: RueckfrageLeser;
}

interface ZustellOptionen {
  store: ZustellSpeicher;
  konsultPlaetze?: KonsultPlaetze;
  holdMs?: number;
  webhookHoldMs?: number;
  tickMs?: number;
  summaryWaitMs?: number;
  rueckfrageGelesen?: RueckfrageLeser;
}

interface KonsultEreignis {
  event: string;
  eventId: string | null;
  questions: readonly unknown[];
}

interface KonsultZustellung {
  waitForEvent(anfrage: WarteAnfrage): Promise<KonsultEreignis>;
  withOpenSlot(
    callId: string,
    tenantId: string,
    run: () => Promise<unknown>,
  ): Promise<{ granted: boolean; value: unknown }>;
  releaseOpenPolls(): void;
  isDraining(): boolean;
  openPollCount(callId: string): number;
}

interface WarteAnfrage {
  callId: string;
  tenantId: string;
  afterEventId?: string | null;
  signal?: AbortSignal;
}

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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const rueckfrageAusSpeicher =
  (store: ZustellSpeicher): RueckfrageLeser =>
  async (callId, _tenantId, afterEventId) => ({
    consult: store.pendingConsult(callId, afterEventId),
    status: (await store.leseCallUngebunden(callId))?.status ?? null,
  });

export function makeConsultDelivery({
  store,
  konsultPlaetze = store.konsultPlaetze ?? makeKonsultPlaetze(),
  holdMs = CONSULT_POLL_HOLD_MS,
  webhookHoldMs = holdMs,
  tickMs = CONSULT_POLL_TICK_MS,
  summaryWaitMs = CONSULT_DONE_SUMMARY_WAIT_MS,
  rueckfrageGelesen = store.rueckfrageGelesen ?? rueckfrageAusSpeicher(store),
}: ZustellOptionen): KonsultZustellung {
  let draining = false;

  const claimSlot = (callId: string, tenantId: string, haltefristMs: number) =>
    konsultPlaetze.belegen({
      callId,
      tenantId,
      jeAnruf: MAX_OPEN_POLLS_PER_CALL,
      jeMandant: MAX_OPEN_POLLS_PER_TENANT,
      haltefristMs: haltefristMs + CONSULT_POLL_ABORT_MARGIN_MS,
    });

  async function currentEvent(
    callId: string,
    tenantId: string,
    afterEventId: string | null | undefined,
  ) {
    const { consult, status } = await rueckfrageGelesen(callId, tenantId, afterEventId);
    if (consult)
      return {
        event: CONSULT_EVENT.CONSULT,
        eventId: consult.id,
        questions: consult.questions,
      };
    return status !== null && status !== "active" ? DONE_EVENT : NO_EVENT;
  }

  async function awaitsSummary(callId: string) {
    const call = await store.leseCallUngebunden(callId);
    if (call?.status !== "completed" || call.summary || !call.transcript?.length) return false;
    return store.tenantContext(call.tenantId).settings.allowSummaries === true;
  }

  function summaryWait() {
    let until: number | null = null;
    return async (callId: string, event: { event: string }) => {
      if (event.event !== CONSULT_EVENT.DONE || draining) return false;
      if (!(await awaitsSummary(callId))) return false;
      until ??= Date.now() + summaryWaitMs;
      return Date.now() < until;
    };
  }

  async function waitForEvent({
    callId,
    tenantId,
    afterEventId,
    signal,
  }: WarteAnfrage): Promise<KonsultEreignis> {
    const platzId = await claimSlot(callId, tenantId, holdMs);
    if (platzId === null) return NO_EVENT;
    const deadline = Date.now() + holdMs;
    const summaryPending = summaryWait();
    try {
      for (;;) {
        const event = await currentEvent(callId, tenantId, afterEventId);
        if (event.event !== CONSULT_EVENT.NONE && !(await summaryPending(callId, event)))
          return event;
        if (draining || signal?.aborted || Date.now() >= deadline) return NO_EVENT;
        await sleep(tickMs);
      }
    } finally {
      await konsultPlaetze.freigeben(platzId);
    }
  }

  async function withOpenSlot(
    callId: string,
    tenantId: string,
    run: () => Promise<unknown>,
  ): Promise<{ granted: boolean; value: unknown }> {
    const platzId = await claimSlot(callId, tenantId, webhookHoldMs);
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
    openPollCount: (callId: string) => konsultPlaetze.offenJeAnruf(callId),
  };
}

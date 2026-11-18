import { BRIDGE_STATE, bridgeStateOf } from "./inbound-bridge-state.ts";

export const EL_BRIDGE_START_DEADLINE_MS = 30000;
export const EL_BINDING_AFTER_ANSWER_MS = 8000;

export const EL_RUECKFALL_PFAD = "/voice/el-rueckfall";
export const EL_RUECKFALL_QUELLE = Object.freeze({ DIAL_ENDE: "dial_ende", FRIST: "frist" });

const FRIST_ART = Object.freeze({ AUSSEN: "aussen", INNEN: "innen", LAUF: "lauf" });
export const LOG_TAG = "el-inbound";

type Handle = ReturnType<typeof setTimeout>;

export interface Anruf {
  id: string;
  tenantId: string;
  status?: unknown;
  answeredAt: string;
  provider?: string;
  twilioSid?: string;
}

interface Umleitung {
  call: Anruf | null | undefined;
  rueckfallUrl: string;
}

interface InboundBridges {
  armDeadlines: (callId: string) => void;
  armBindingDeadline: (callId: string) => void;
  clearDeadlines: (callId: string) => void;
  rearmDeadlines: () => void;
  uebergabeDurchLauf: (callId: string) => Promise<void>;
}

export function elRueckfallUrl({ callId, quelle }: { callId: string; quelle: string }): string {
  return `${EL_RUECKFALL_PFAD}?${new URLSearchParams({ callId, quelle }).toString()}`;
}

export function aeussereRestfristMs(call: Anruf, nowMs: number): number {
  const rest = Date.parse(call.answeredAt) + EL_BRIDGE_START_DEADLINE_MS - nowMs;
  return Number.isFinite(rest) ? Math.max(0, rest) : 0;
}

const umleitungFaellig = (call: Anruf | null | undefined): boolean =>
  call?.status === "active" && bridgeStateOf(call) === BRIDGE_STATE.WARTET;

export function makeInboundBridges({
  store,
  umleiten,
  setTimer,
  clearTimer = clearTimeout,
  now,
  uebernahmeMs = 0,
}: {
  store: {
    getCall: (id: string) => Anruf | null | undefined;
    setzeUebergabeFrist?: (frist: { callId: string; tenantId: string; faelligAt: string }) => Promise<unknown>;
    leseCallUngebunden?: (id: string) => Promise<Anruf | null | undefined>;
    load: () => { calls: Anruf[] };
  };
  umleiten: (umleitung: Umleitung) => unknown;
  setTimer: (fn: () => void, ms: number) => Handle;
  clearTimer?: (handle: Handle) => void;
  now: () => number;
  uebernahmeMs?: number;
}): InboundBridges {
  const fristen = new Map<string, Record<string, Handle>>();

  function clearDeadlines(callId: string): void {
    const eintrag = fristen.get(callId);
    if (!eintrag) return;
    for (const handle of Object.values(eintrag)) clearTimer(handle);
    fristen.delete(callId);
  }

  function mitAnruf(callId: string, weiter: (call: Anruf | null | undefined) => void): void {
    if (!store.leseCallUngebunden) {
      weiter(store.getCall(callId));
      return;
    }
    store.leseCallUngebunden(callId).then(weiter, () => {
      weiter(null);
    });
  }

  function leiteUmWennWartend(callId: string, art: string, call: Anruf | null | undefined): void {
    if (!umleitungFaellig(call)) return;
    console.log(`[${LOG_TAG}] frist_abgelaufen call=${callId} frist=${art}`);
    void umleiten({ call, rueckfallUrl: elRueckfallUrl({ callId, quelle: EL_RUECKFALL_QUELLE.FRIST }) });
  }

  function fristAbgelaufen(callId: string, art: string): void {
    clearDeadlines(callId);
    mitAnruf(callId, (call) => {
      leiteUmWennWartend(callId, art, call);
    });
  }

  async function uebergabeDurchLauf(callId: string): Promise<void> {
    const call = store.leseCallUngebunden ? await store.leseCallUngebunden(callId) : store.getCall(callId);
    leiteUmWennWartend(callId, FRIST_ART.LAUF, call);
  }

  function schreibeFrist(callId: string, faelligMs: number): void {
    mitAnruf(callId, (call) => {
      if (!call) return;
      const faelligAt = new Date(faelligMs + uebernahmeMs).toISOString();
      store.setzeUebergabeFrist?.({ callId, tenantId: call.tenantId, faelligAt }).catch((fehler: unknown) => {
        console.error(`[fristen] Uebergabe-Frist schreiben fehlgeschlagen: ${callId} ${String(fehler)}`);
      });
    });
  }

  function armiere(callId: string, art: string, ms: number): void {
    schreibeFrist(callId, now() + ms);
    const eintrag = fristen.get(callId) ?? {};
    if (eintrag[art]) clearTimer(eintrag[art]);
    fristen.set(callId, { ...eintrag, [art]: setTimer(() => {
        fristAbgelaufen(callId, art);
      }, ms) });
  }

  function armDeadlines(callId: string): void {
    mitAnruf(callId, (call) => {
      if (call) armiere(callId, FRIST_ART.AUSSEN, aeussereRestfristMs(call, now()));
    });
  }

  function armBindingDeadline(callId: string): void {
    armiere(callId, FRIST_ART.INNEN, EL_BINDING_AFTER_ANSWER_MS);
  }

  function rearmDeadlines(): void {
    const wartende = store.load().calls.filter(umleitungFaellig);
    const nowMs = now();
    for (const call of wartende) armiere(call.id, FRIST_ART.AUSSEN, aeussereRestfristMs(call, nowMs));
    if (wartende.length > 0) console.log(`[${LOG_TAG}] Fristen re-armiert: ${String(wartende.length)} Anrufe`);
  }

  return { armDeadlines, armBindingDeadline, clearDeadlines, rearmDeadlines, uebergabeDurchLauf };
}

import { BRIDGE_STATE, bridgeStateOf } from "./inbound-bridge-state.ts";

export const EL_BRIDGE_START_DEADLINE_MS = 30000;
export const EL_BINDING_AFTER_ANSWER_MS = 8000;

export const EL_RUECKFALL_PFAD = "/voice/el-rueckfall";
export const EL_RUECKFALL_QUELLE = Object.freeze({ DIAL_ENDE: "dial_ende", FRIST: "frist" });

const FRIST_LAUF = "lauf";
export const LOG_TAG = "el-inbound";

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
  now,
  uebernahmeMs = 0,
}: {
  store: {
    getCall: (id: string) => Anruf | null | undefined;
    setzeUebergabeFrist?: (frist: { callId: string; tenantId: string; faelligAt: string | null }) => Promise<unknown>;
    leseCallUngebunden?: (id: string) => Promise<Anruf | null | undefined>;
    load: () => { calls: Anruf[] };
  };
  umleiten: (umleitung: Umleitung) => unknown;
  now: () => number;
  uebernahmeMs?: number;
}): InboundBridges {
  function mitAnruf(callId: string, weiter: (call: Anruf | null | undefined) => void): void {
    if (!store.leseCallUngebunden) {
      weiter(store.getCall(callId));
      return;
    }
    store.leseCallUngebunden(callId).then(weiter, () => {
      weiter(null);
    });
  }

  function leiteUmWennWartend(callId: string, art: string, call: Anruf | null | undefined): unknown {
    if (!umleitungFaellig(call)) return undefined;
    console.log(`[${LOG_TAG}] frist_abgelaufen call=${callId} frist=${art}`);
    return umleiten({ call, rueckfallUrl: elRueckfallUrl({ callId, quelle: EL_RUECKFALL_QUELLE.FRIST }) });
  }

  async function uebergabeDurchLauf(callId: string): Promise<void> {
    const call = store.leseCallUngebunden ? await store.leseCallUngebunden(callId) : store.getCall(callId);
    if ((await leiteUmWennWartend(callId, FRIST_LAUF, call)) === false)
      throw new Error(`Uebergabe weder umgeleitet noch aufgelegt: ${callId}`);
  }

  function schreibeFrist(callId: string, faelligMs: number | null): void {
    mitAnruf(callId, (call) => {
      if (!call) return;
      const faelligAt = faelligMs === null ? null : new Date(faelligMs + uebernahmeMs).toISOString();
      store.setzeUebergabeFrist?.({ callId, tenantId: call.tenantId, faelligAt }).catch((fehler: unknown) => {
        console.error(`[fristen] Uebergabe-Frist schreiben fehlgeschlagen: ${callId} ${String(fehler)}`);
      });
    });
  }

  function armDeadlines(callId: string): void {
    mitAnruf(callId, (call) => {
      if (call) schreibeFrist(callId, now() + aeussereRestfristMs(call, now()));
    });
  }

  function armBindingDeadline(callId: string): void {
    schreibeFrist(callId, now() + EL_BINDING_AFTER_ANSWER_MS);
  }

  function clearDeadlines(callId: string): void {
    schreibeFrist(callId, null);
  }

  return { armDeadlines, armBindingDeadline, clearDeadlines, uebergabeDurchLauf };
}

import { BRIDGE_STATE, bridgeStateOf } from "./inbound-bridge-state.js";
import { defaultSetTimer } from "../utils/timer.js";

export const EL_BRIDGE_START_DEADLINE_MS = 30000;
export const EL_BINDING_AFTER_ANSWER_MS = 8000;

export const EL_RUECKFALL_PFAD = "/voice/el-rueckfall";
export const EL_RUECKFALL_QUELLE = Object.freeze({ DIAL_ENDE: "dial_ende", FRIST: "frist" });

const FRIST_ART = Object.freeze({ AUSSEN: "aussen", INNEN: "innen" });
const LOG_TAG = "el-inbound";

type Handle = ReturnType<typeof setTimeout>;

interface Anruf {
  id: string;
  status?: unknown;
  answeredAt: string;
  provider?: string;
  twilioSid?: string;
}

interface Umleitung {
  call: Anruf | null | undefined;
  rueckfallUrl: string;
}

interface Telefonie {
  redirectCall?: (sid: string | undefined, url: string) => Promise<unknown>;
}

interface InboundBridges {
  armDeadlines: (callId: string) => void;
  armBindingDeadline: (callId: string) => void;
  clearDeadlines: (callId: string) => void;
  rearmDeadlines: () => void;
}

const fehlertext = (err: unknown): string => String(Reflect.get(Object(err), "message"));

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
  setTimer = defaultSetTimer,
  clearTimer = clearTimeout,
  now = Date.now,
}: {
  store: { getCall: (id: string) => Anruf | null | undefined; load: () => { calls: Anruf[] } };
  umleiten: (umleitung: Umleitung) => unknown;
  setTimer?: (fn: () => void, ms: number) => Handle;
  clearTimer?: (handle: Handle) => void;
  now?: () => number;
}): InboundBridges {
  const fristen = new Map<string, Record<string, Handle>>();

  function clearDeadlines(callId: string): void {
    const eintrag = fristen.get(callId);
    if (!eintrag) return;
    for (const handle of Object.values(eintrag)) clearTimer(handle);
    fristen.delete(callId);
  }

  function fristAbgelaufen(callId: string, art: string): void {
    const call = store.getCall(callId);
    clearDeadlines(callId);
    if (!umleitungFaellig(call)) return;
    console.log(`[${LOG_TAG}] frist_abgelaufen call=${callId} frist=${art}`);
    void umleiten({ call, rueckfallUrl: elRueckfallUrl({ callId, quelle: EL_RUECKFALL_QUELLE.FRIST }) });
  }

  function armiere(callId: string, art: string, ms: number): void {
    const eintrag = fristen.get(callId) ?? {};
    if (eintrag[art]) clearTimer(eintrag[art]);
    fristen.set(callId, { ...eintrag, [art]: setTimer(() => {
        fristAbgelaufen(callId, art);
      }, ms) });
  }

  function armDeadlines(callId: string): void {
    const call = store.getCall(callId);
    if (!call) return;
    armiere(callId, FRIST_ART.AUSSEN, aeussereRestfristMs(call, now()));
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

  return { armDeadlines, armBindingDeadline, clearDeadlines, rearmDeadlines };
}

export async function umleitenOderAuflegen({
  voiceControl,
  endCarrierCall,
  call,
  url,
}: {
  voiceControl: (provider: string | undefined) => Telefonie;
  endCarrierCall: (callId: string) => unknown;
  call: Anruf;
  url: string;
}): Promise<void> {
  try {
    await leiteUm(voiceControl(call.provider), call, url);
    console.log(`[${LOG_TAG}] umgeleitet call=${call.id}`);
  } catch (err) {
    console.warn(`[${LOG_TAG}] umleitung_fehlgeschlagen call=${call.id}: ${fehlertext(err)}`);
    await legeTraegerAuf(endCarrierCall, call.id);
  }
}

async function leiteUm(port: Telefonie, call: Anruf, url: string): Promise<void> {
  if (typeof port.redirectCall !== "function")
    throw new Error("Telefonie-Port bietet keine Live-Umleitung (redirectCall)");
  await port.redirectCall(call.twilioSid, url);
}

async function legeTraegerAuf(endCarrierCall: (callId: string) => unknown, callId: string): Promise<void> {
  try {
    await endCarrierCall(callId);
  } catch (err) {
    console.warn(`[${LOG_TAG}] auflegen_fehlgeschlagen call=${callId}: ${fehlertext(err)}`);
  }
}

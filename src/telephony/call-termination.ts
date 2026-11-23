import { endeLagAnderswo } from "../begriffe/anruf-zustand.ts";
import { BRIDGE_STATE, bridgeStateOf } from "../elevenlabs/inbound-bridge-state.ts";

interface CallRef {
  id: string;
  elevenlabsConversationId?: string | null;
}

interface Call extends CallRef {
  provider?: string;
  callControlId: string;
  elCallControlId: string;
}

type HangUp = (() => Promise<unknown>) | null | undefined;

interface VoiceControl {
  endCall: (providerCallSid: string) => Promise<unknown>;
  endCallViaCallControl: (callControlId: string) => Promise<unknown>;
}

interface TerminateRequest {
  persistEnd: () => unknown;
  hangUp?: HangUp;
  bill: () => unknown;
  onHangUpError?: (fehler: unknown) => void;
  callId?: string | null;
}

const offeneAbrechnungen = new Set<Promise<void>>();

export async function warteAufOffeneAbrechnungen(): Promise<void> {
  await Promise.allSettled([...offeneAbrechnungen]);
}

function verfolgeAbrechnung(bill: () => unknown, callId: string | null | undefined): void {
  const meldeFehler = (fehler: unknown) => {
    const meldung: unknown = Reflect.get(Object(fehler), "message");
    console.error(`[terminateAndBillCall] Settlement fehlgeschlagen (call=${callId ?? "unbekannt"}):`, meldung);
  };
  const abrechnung: Promise<void> = Promise.resolve(bill())
    .then(() => undefined, meldeFehler)
    .finally(() => offeneAbrechnungen.delete(abrechnung));
  offeneAbrechnungen.add(abrechnung);
}

export async function terminateAndBillCall({
  persistEnd,
  hangUp,
  bill,
  onHangUpError,
  callId,
}: TerminateRequest): Promise<void> {
  if (typeof bill !== "function")
    throw new TypeError("terminateAndBillCall: bill (Settlement) ist Pflicht - kein Function uebergeben");
  try {
    await persistEnd();
  } finally {
    if (hangUp) {
      try {
        await hangUp();
      } catch (fehler) {
        onHangUpError?.(fehler);
      }
    }
  }
  verfolgeAbrechnung(bill, callId);
}

export function billThunk(
  finishCall: (call: unknown) => unknown,
  store: { getCall: (callId: string) => unknown },
  callId: string,
): () => unknown {
  return () => {
    const call = store.getCall(callId);
    return endeLagAnderswo(call) ? undefined : finishCall(call);
  };
}

async function legeCallControlBeineAuf(steuerung: VoiceControl, call: Call): Promise<void> {
  const beine = [call.callControlId, call.elCallControlId].filter(Boolean);
  const ergebnisse = await Promise.allSettled(beine.map((bein) => steuerung.endCallViaCallControl(bein)));
  const gescheitert = ergebnisse.find((ergebnis) => ergebnis.status === "rejected");
  if (gescheitert) throw gescheitert.reason;
}

export function hangUpAction(
  voiceControl: (provider: string | undefined) => VoiceControl,
  call: Call,
  providerCallSid?: string | null,
): HangUp {
  if (call.callControlId) return () => legeCallControlBeineAuf(voiceControl(call.provider), call);
  if (providerCallSid) return () => voiceControl(call.provider).endCall(providerCallSid);
  return null;
}

export function elevenLabsHangUpAction(
  endActiveCall: ((callId: string) => Promise<unknown>) | null | undefined,
  call: CallRef,
): HangUp {
  if (!call.elevenlabsConversationId || typeof endActiveCall !== "function") return null;
  if (bridgeStateOf(call) !== BRIDGE_STATE.KEIN_EL_INBOUND) return null;
  return () => endActiveCall(call.id);
}

interface BridgedHangUpRequest {
  call: CallRef;
  hangUp: HangUp;
  awaitAndPersistInboundElResult: (callId: string) => Promise<unknown>;
}

export function hangUpForCall({ call, hangUp, awaitAndPersistInboundElResult }: BridgedHangUpRequest): HangUp {
  if (bridgeStateOf(call) !== BRIDGE_STATE.GEBUNDEN) return hangUp;
  return bridgedInboundHangUp({ carrierHangUp: hangUp, awaitAndPersistInboundElResult, callId: call.id });
}

function bridgedInboundHangUp({
  carrierHangUp,
  awaitAndPersistInboundElResult,
  callId,
}: {
  carrierHangUp: HangUp;
  awaitAndPersistInboundElResult: (callId: string) => Promise<unknown>;
  callId: string;
}): () => Promise<void> {
  return async () => {
    try {
      await carrierHangUp?.();
    } finally {
      await awaitAndPersistInboundElResult(callId);
    }
  };
}

export function persistEndWithReason<Grund extends string | null>({
  store,
  callId,
  reason,
  endCall,
}: {
  store: { recordFailureReason: (callId: string, reason: Grund) => unknown };
  callId: string;
  reason: Grund;
  endCall: () => unknown;
}): () => Promise<void> {
  return async () => {
    store.recordFailureReason(callId, reason);
    await endCall();
  };
}

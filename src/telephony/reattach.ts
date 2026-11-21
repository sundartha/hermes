import type { AnrufZustand } from "../begriffe/anruf-zustand.ts";
import { classifyCallTime } from "../store/state-ops.js";
import { makeKeyedSingleFlight } from "../single-flight.ts";

interface AktiverAnruf {
  id: string;
  twilioSid: string;
  status?: string;
}

interface ReattachAbhaengigkeiten {
  attachActiveCall: (callId: string) => Promise<AktiverAnruf | null | undefined>;
  maxCallDurationS: number;
  terminateCappedCall: (callId: string, sid: string, status: AnrufZustand) => Promise<unknown>;
  scheduleMaxDurationEnd: (call: AktiverAnruf, sid: string, remaining: number) => unknown;
  budgetAxisFor: (call: AktiverAnruf) => unknown;
  terminateOverBudgetCall: (callId: string, sid: string) => Promise<unknown>;
}

interface ReattachErgebnis {
  call: AktiverAnruf | null;
  logUnknown?: boolean;
  fehlgeschlagen?: boolean;
}

export const reattachActiveCall = makeKeyedSingleFlight(runReattach);

async function runReattach(
  callId: string,
  {
    attachActiveCall,
    maxCallDurationS,
    terminateCappedCall,
    scheduleMaxDurationEnd,
    budgetAxisFor,
    terminateOverBudgetCall,
  }: ReattachAbhaengigkeiten,
): Promise<ReattachErgebnis> {
  let call: AktiverAnruf | null | undefined;
  try {
    call = await attachActiveCall(callId);
  } catch {
    return { call: null, logUnknown: false, fehlgeschlagen: true };
  }
  if (call?.status !== "active") return { call: null, logUnknown: true };
  const { remaining, expired } = classifyCallTime(call, Date.now(), maxCallDurationS);
  if (expired) {
    await terminateCappedCall(call.id, call.twilioSid, "failed");
    return { call: null, logUnknown: false };
  }
  if (await budgetAxisFor(call)) {
    await terminateOverBudgetCall(call.id, call.twilioSid);
    return { call: null, logUnknown: false };
  }
  scheduleMaxDurationEnd(call, call.twilioSid, remaining);
  return { call };
}

export async function uebernehmeOhneArmierung(
  callId: string,
  attachActiveCall: ReattachAbhaengigkeiten["attachActiveCall"],
): Promise<AktiverAnruf | null> {
  const call = await attachActiveCall(callId);
  return call?.status === "active" ? call : null;
}

export async function inDatenbankBeendet(
  callId: string,
  attachActiveCall: (callId: string, optionen: { mandant: string }) => Promise<AktiverAnruf | null | undefined>,
  mandant: string,
): Promise<boolean> {
  try {
    return (await uebernehmeOhneArmierung(callId, (id) => attachActiveCall(id, { mandant }))) === null;
  } catch {
    return false;
  }
}

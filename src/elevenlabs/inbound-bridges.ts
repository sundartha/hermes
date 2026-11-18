import { LOG_TAG, type Anruf } from "./inbound-fristen.ts";

export {
  EL_BINDING_AFTER_ANSWER_MS,
  EL_BRIDGE_START_DEADLINE_MS,
  EL_RUECKFALL_PFAD,
  EL_RUECKFALL_QUELLE,
  aeussereRestfristMs,
  elRueckfallUrl,
  makeInboundBridges,
} from "./inbound-fristen.ts";

interface Telefonie {
  redirectCall?: (sid: string | undefined, url: string) => Promise<unknown>;
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

function fehlertext(err: unknown): string {
  return String(Reflect.get(Object(err), "message"));
}

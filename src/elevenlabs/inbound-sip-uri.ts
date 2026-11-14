import { E164 } from "../begriffe/rufnummern.js";

const EL_SIP_HOST = "sip.rtc.elevenlabs.io";
const EL_SIP_PORT = "5060";
const EL_SIP_TRANSPORT = "tcp";

export const EL_CALL_BINDING_SIP_HEADER = "X-Hermes-Call-Binding";

const istE164 = (did: unknown): boolean => typeof did === "string" && E164.test(did);
function pruefeToken(token: unknown): string {
  if (typeof token !== "string" || token.length === 0) throw new Error("elSipUri: Bindungs-Token fehlt");
  return token;
}

export function elSipZiel(did: string): string {
  if (!istE164(did)) throw new Error("elSipZiel: Absender ist keine E.164-Nummer");
  return `sip:${did}@${EL_SIP_HOST}`;
}

export function elSipUri({ did, token }: { did: string; token: unknown }): string {
  if (!istE164(did)) throw new Error("elSipUri: DID ist keine E.164-Nummer");
  const bindung = pruefeToken(token);
  return (
    `sip:${did}@${EL_SIP_HOST}:${EL_SIP_PORT};transport=${EL_SIP_TRANSPORT}` +
    `?${EL_CALL_BINDING_SIP_HEADER}=${encodeURIComponent(bindung)}`
  );
}

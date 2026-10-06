import { E164 } from "../store/defaults.js";

const EL_SIP_HOST = "sip.rtc.elevenlabs.io";
const EL_SIP_PORT = 5060;
const EL_SIP_TRANSPORT = "tcp";

export const EL_CALL_BINDING_SIP_HEADER = "X-Hermes-Call-Binding";

const istE164 = (did) => typeof did === "string" && E164.test(did);
const istToken = (token) => typeof token === "string" && token.length > 0;

export function elSipUri({ did, token }) {
  if (!istE164(did)) throw new Error("elSipUri: DID ist keine E.164-Nummer");
  if (!istToken(token)) throw new Error("elSipUri: Bindungs-Token fehlt");
  return (
    `sip:${did}@${EL_SIP_HOST}:${EL_SIP_PORT};transport=${EL_SIP_TRANSPORT}` +
    `?${EL_CALL_BINDING_SIP_HEADER}=${encodeURIComponent(token)}`
  );
}

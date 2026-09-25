// IEL-B7 (L1): die SIP-Ziel-URI, unter der ein eingehender Anruf an den ElevenLabs-Agenten
// uebergeben wird. Rein: kein config, kein Netz, kein Log.
// Fest sind Host, Port und Transport ([M1] F-A, M4 TCP). Variabel sind nur die eigene DID
// (URI-User = Registrierung beim Anbieter, [M1] F-A) und das Bindungs-Token als URI-Header
// ([M1] F-B/M9: der Anbieter reicht ihn als sip_hermes_call_binding weiter).
// KEIN EINGABEFELD VERAENDERT DEN HOST: die DID muss E.164 sein (sonst wirft der Bau), das
// Token wird URI-kodiert (kein ';', '@', '?' aus dem Wert). Fehlertexte nennen keinen Wert.
import { E164 } from "../store/defaults.js";

const EL_SIP_HOST = "sip.rtc.elevenlabs.io";
const EL_SIP_PORT = 5060;
const EL_SIP_TRANSPORT = "tcp";

// EINE Quelle fuer Schreiber (diese URI) und Leser (inbound-initiation.js, Init-Webhook).
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

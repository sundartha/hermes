import { fetchConversation, fetchPhoneNumber } from "./convai.ts";
import {
  ANSWERED_REASON_NOT_ANSWERED,
  ELEVENLABS_PROVIDER_MAX_DURATION_S,
  endeSchreiberFuer,
  makeElevenLabsOutbound,
  mitAuftragsurteil,
} from "./outbound.js";
import { callLocaleOf } from "./call-locale.ts";
import { makeVorspannErzeuger } from "./outbound-vorspann.js";

export type { ConvaiKonto } from "./convai.ts";

interface KontoPort {
  fetchConversation: typeof fetchConversation;
  fetchPhoneNumber: typeof fetchPhoneNumber;
}

interface AnrufstartPort {
  makeElevenLabsOutbound: typeof makeElevenLabsOutbound;
  mitAuftragsurteil: typeof mitAuftragsurteil;
  makeVorspannErzeuger: typeof makeVorspannErzeuger;
  callLocaleOf: typeof callLocaleOf;
  endeSchreiberFuer: typeof endeSchreiberFuer;
  ELEVENLABS_PROVIDER_MAX_DURATION_S: typeof ELEVENLABS_PROVIDER_MAX_DURATION_S;
  ANSWERED_REASON_NOT_ANSWERED: typeof ANSWERED_REASON_NOT_ANSWERED;
}


const ADAPTER_CONVAI: KontoPort = Object.freeze({ fetchConversation, fetchPhoneNumber });
const ADAPTER_OUTBOUND: AnrufstartPort = Object.freeze({
  makeElevenLabsOutbound,
  mitAuftragsurteil,
  makeVorspannErzeuger,
  callLocaleOf,
  endeSchreiberFuer,
  ELEVENLABS_PROVIDER_MAX_DURATION_S,
  ANSWERED_REASON_NOT_ANSWERED,
});

export const elevenlabsConvai = (): KontoPort => ADAPTER_CONVAI;
export const elevenlabsOutbound = (): AnrufstartPort => ADAPTER_OUTBOUND;

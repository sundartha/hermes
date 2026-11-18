import { fetchConversation, fetchPhoneNumber } from "./convai.ts";
import { makeElevenLabsOutbound, mitAuftragsurteil } from "./outbound.js";
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
}

const ADAPTER_CONVAI: KontoPort = Object.freeze({ fetchConversation, fetchPhoneNumber });
const ADAPTER_OUTBOUND: AnrufstartPort = Object.freeze({ makeElevenLabsOutbound, mitAuftragsurteil, makeVorspannErzeuger });

export const elevenlabsConvai = (): KontoPort => ADAPTER_CONVAI;
export const elevenlabsOutbound = (): AnrufstartPort => ADAPTER_OUTBOUND;

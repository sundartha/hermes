import { fetchConversation, fetchPhoneNumber } from "./convai.ts";

export type { ConvaiKonto } from "./convai.ts";

interface KontoPort {
  fetchConversation: typeof fetchConversation;
  fetchPhoneNumber: typeof fetchPhoneNumber;
}

const ADAPTER_CONVAI: KontoPort = Object.freeze({ fetchConversation, fetchPhoneNumber });

export const elevenlabsConvai = (): KontoPort => ADAPTER_CONVAI;

import { fetchConversation, fetchPhoneNumber } from "./convai.ts";

export type { ConvaiKonto } from "./convai.ts";

const ADAPTER_CONVAI = Object.freeze({ fetchConversation, fetchPhoneNumber });

export const elevenlabsConvai = () => ADAPTER_CONVAI;

import { anfrage } from "../utils/anfrage.js";
import { elevenlabsConvai, type ConvaiKonto } from "../elevenlabs/registry.ts";

export function makeElConfigRead(config: { voice: { elevenLabsOutbound: ConvaiKonto } }): {
  fetchPhoneNumber: (phoneNumberId: string) => ReturnType<ReturnType<typeof elevenlabsConvai>["fetchPhoneNumber"]>;
} {
  return {
    fetchPhoneNumber: (phoneNumberId: string) =>
      elevenlabsConvai().fetchPhoneNumber({ fetchImpl: anfrage, account: config.voice.elevenLabsOutbound, phoneNumberId }),
  };
}

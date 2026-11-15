import { anfrage } from "../utils/anfrage.js";
import { fetchPhoneNumber, type ConvaiKonto } from "../elevenlabs/convai.ts";

export function makeElConfigRead(config: { voice: { elevenLabsOutbound: ConvaiKonto } }): {
  fetchPhoneNumber: (phoneNumberId: string) => ReturnType<typeof fetchPhoneNumber>;
} {
  return {
    fetchPhoneNumber: (phoneNumberId: string) =>
      fetchPhoneNumber({ fetchImpl: anfrage, account: config.voice.elevenLabsOutbound, phoneNumberId }),
  };
}

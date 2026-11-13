import { anfrage } from "../utils/anfrage.js";
import { fetchPhoneNumber } from "../elevenlabs/convai.js";

export function makeElConfigRead(config: { voice: { elevenLabsOutbound: unknown } }): {
  fetchPhoneNumber: (phoneNumberId: string) => ReturnType<typeof fetchPhoneNumber>;
} {
  return {
    fetchPhoneNumber: (phoneNumberId: string) =>
      fetchPhoneNumber({ fetchImpl: anfrage, account: config.voice.elevenLabsOutbound, phoneNumberId }),
  };
}

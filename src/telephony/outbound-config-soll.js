import { anfrage } from "../utils/anfrage.js";
import { fetchPhoneNumber } from "../elevenlabs/convai.js";

export function makeElConfigRead(config) {
  return {
    fetchPhoneNumber: (phoneNumberId) =>
      fetchPhoneNumber({ fetchImpl: anfrage, account: config.voice.elevenLabsOutbound, phoneNumberId }),
  };
}

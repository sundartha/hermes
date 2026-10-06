import { fetchPhoneNumber } from "../elevenlabs/convai.js";

export function makeElConfigRead(config) {
  return {
    fetchPhoneNumber: (phoneNumberId) =>
      fetchPhoneNumber({ fetchImpl: fetch, account: config.voice.elevenLabsOutbound, phoneNumberId }),
  };
}

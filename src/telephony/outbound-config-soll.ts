import { anfrage } from "../utils/anfrage.ts";
import { elevenlabsConvai, type ConvaiKonto } from "../elevenlabs/registry.ts";

export function makeElConfigRead(config: { voice: { elevenLabsOutbound: ConvaiKonto } }): {
  fetchPhoneNumber: (phoneNumberId: string, optionen?: { timeoutMs: number }) => ReturnType<ReturnType<typeof elevenlabsConvai>["fetchPhoneNumber"]>;
} {
  return {
    fetchPhoneNumber: (phoneNumberId: string, optionen?: { timeoutMs: number }) =>
      elevenlabsConvai().fetchPhoneNumber({ fetchImpl: anfrage, account: config.voice.elevenLabsOutbound, phoneNumberId, ...optionen }),
  };
}

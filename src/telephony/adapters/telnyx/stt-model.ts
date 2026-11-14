import { DEFAULT_STT_PROFILE, STT_PROFILE } from "../../stt-profile.ts";

const TELNYX_STT: Readonly<Record<string, { engine: string; model: string }>> = Object.freeze({
  [STT_PROFILE.ACCURATE]: Object.freeze({ engine: "Deepgram", model: "deepgram/nova-3" }),
});

export function sttAttrs(profile: string = DEFAULT_STT_PROFILE): { engine: string; model: string } {
  const attrs = TELNYX_STT[profile];
  if (!attrs) throw new Error(`unbekanntes sttProfile: ${profile}`);
  return attrs;
}

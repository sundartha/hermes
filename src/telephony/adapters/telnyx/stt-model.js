import { DEFAULT_STT_PROFILE, STT_PROFILE } from "../../stt-profile.js";

const TELNYX_STT = Object.freeze({
  [STT_PROFILE.ACCURATE]: Object.freeze({ engine: "Deepgram", model: "deepgram/nova-3" }),
});

export function sttAttrs(profile = DEFAULT_STT_PROFILE) {
  const attrs = TELNYX_STT[profile];
  if (!attrs) throw new Error(`unbekanntes sttProfile: ${profile}`);
  return attrs;
}

import { VOICE_PROFILE } from "../../directives.js";

export const ELEVENLABS_VOICE_ID_BY_PROFILE = Object.freeze({
  [VOICE_PROFILE.DE_FEMALE_NEURAL]: "cqPdIo76zSHFDcSZpFov",
  [VOICE_PROFILE.FR_FEMALE_NEURAL]: "WeAAwKYcS06VmXw086yZ",
  [VOICE_PROFILE.EN_FEMALE_NEURAL]: "ZSNL4hPqCnqoMPaI4jGX",
});

export function elevenLabsVoiceIdFor(defaultVoiceId, voiceProfile) {
  return ELEVENLABS_VOICE_ID_BY_PROFILE[voiceProfile] || defaultVoiceId;
}

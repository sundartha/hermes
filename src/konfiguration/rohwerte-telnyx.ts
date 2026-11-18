export function rohwerteTelnyx(env: { TELNYX_ELEVENLABS_VOICE_ID?: string | undefined }) {
  return {
    telnyxElevenLabs: {
      voiceId: env.TELNYX_ELEVENLABS_VOICE_ID ?? "",
    },
  };
}

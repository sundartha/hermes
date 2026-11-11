export function rohwerteTelnyx(env) {
  return {
    telnyxElevenLabs: {
      voiceId: env.TELNYX_ELEVENLABS_VOICE_ID || "",
    },
  };
}

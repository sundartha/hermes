export function telnyxRohwerte(umgebung) {
  const { env } = umgebung;
  return {
    telnyxElevenLabs: {
      voiceId: env.TELNYX_ELEVENLABS_VOICE_ID || "",
    },
  };
}

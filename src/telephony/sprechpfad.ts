export const SPRECHPFAD = Object.freeze({
  PLAY_TTS: "play_tts",
  AZURE_SAY: "azure_say",
  TELNYX_RELAY: "telnyx_relay",
});

const SPRECHPFAD_MATCHERS: readonly (readonly [string, RegExp])[] = Object.freeze([
  [SPRECHPFAD.PLAY_TTS, /<Play>/],
  [SPRECHPFAD.AZURE_SAY, /<Say voice="Azure\./],
  [SPRECHPFAD.TELNYX_RELAY, /<Say voice="ElevenLabs\./],
]);

export function classifySprechpfad(texml: string): string | null {
  for (const [token, pattern] of SPRECHPFAD_MATCHERS) {
    if (pattern.test(texml)) return token;
  }
  return null;
}

export function armedInboundSprechpfad(elevenLabsPlayTts: { enabled: boolean }): string {
  return elevenLabsPlayTts.enabled ? SPRECHPFAD.PLAY_TTS : SPRECHPFAD.AZURE_SAY;
}

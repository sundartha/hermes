import assert from "node:assert/strict";
import { makeDirectiveSynth } from "../../src/tts/directive-synth.js";
import { say } from "../../src/telephony/directives.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { recordingStreamFetch } from "./fake-tts-stream.mjs";

export const PROBE_PLATTFORM_STIMME = "voice123";

const PROBE_PUBLIC_URL = "https://agent.test";
export const PROBE_API_KEY = "sk_test_should_never_leak";
const PROBE_TOKEN = "probe-token-abc";
const PROBE_PROVIDER = "telnyx";

export function playTtsSynthConfig() {
  return withConfigNamespaces({
    publicUrl: PROBE_PUBLIC_URL,
    elevenLabsPlayTts: {
      enabled: true,
      apiKey: PROBE_API_KEY,
      voiceId: PROBE_PLATTFORM_STIMME,
      model: "eleven_flash_v2_5",
      apiBase: "https://api.elevenlabs.io",
      outputFormat: "mp3_44100_128",
      synthTimeoutMs: 2000,
      synthTotalTimeoutMs: 10000,
    },
  });
}

const PROBE_TTS_STORE = Object.freeze({ put: () => PROBE_TOKEN });
const PROBE_COUNTER_STORE = Object.freeze({ recordTtsCharacters: () => null });

export async function runPlayTtsProbe(directives, { ttsStore = PROBE_TTS_STORE, store = PROBE_COUNTER_STORE } = {}) {
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: playTtsSynthConfig(),
    ttsStore,
    store,
    onQuotaWarning: () => assert.fail("onQuotaWarning gehoert nicht zu dieser Messung"),
  });
  const { urls, fetchImpl } = recordingStreamFetch();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const out = await synthesizeDirectiveAudio({ provider: PROBE_PROVIDER }, directives);
    return { out, voiceIds: urls.map(voiceIdOfSynthUrl) };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function voiceIdOfSynthUrl(url) {
  return url.match(/text-to-speech\/([^/?]+)/)[1];
}

export async function playTtsVoiceIdsFor(profiles) {
  const { voiceIds } = await runPlayTtsProbe(profiles.map((profile) => say("Text", profile)));
  assert.equal(voiceIds.length, profiles.length, "je Profil genau ein Synth-Aufruf");
  return voiceIds;
}

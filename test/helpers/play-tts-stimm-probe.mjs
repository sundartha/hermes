// Der geteilte Harnisch der Play-TTS-Vorabsynthese: die Fake-Konfiguration, mit der die
// IP4-Tests makeDirectiveSynth verdrahten, und darauf aufgesetzt EIN Messwerkzeug fuer
// die Voice-ID, mit der diese Vorabsynthese ElevenLabs ruft. Die ID steckt im Pfad der
// Synthese-URL (src/tts/synth.js, TTS_PATH) - am beobachtbaren Ergebnis gemessen, nicht
// an einer Funktionssignatur.
//
// GETEILT von test/directive-synth.test.js (dort entstanden), test/ip4-stimm-anker.test.js
// und test/ip4-tts-kontingent.test.js (nur die Konfiguration). Zwei Kopien wuerden
// driften, und driftet eine, hoert genau eine der Suiten still auf zu messen (Muster
// test/helpers/elevenlabs-anrufstart-attrappe.mjs).
import assert from "node:assert/strict";
import { makeDirectiveSynth } from "../../src/tts/directive-synth.js";
import { say } from "../../src/telephony/directives.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

// Die GLOBALE Plattform-Stimme dieser Attrappe: bewusst ein Wert, der in KEINER
// kuratierten Profil-Karte steht - so faellt ein Rueckfall auf sie sofort auf.
export const PROBE_PLATTFORM_STIMME = "voice123";

const PROBE_PUBLIC_URL = "https://agent.test";
// Der Anbieter-Schluessel dieser Attrappe. Exportiert, damit der Kontingent-Test gegen
// GENAU diesen Wert pruefen kann, dass keine Warnzeile ihn traegt (Absolute Regel 4) -
// eine zweite Literalfassung dort koennte still an der Attrappe vorbeilaufen.
export const PROBE_API_KEY = "sk_test_should_never_leak";
const PROBE_TOKEN = "probe-token-abc";
// Beliebiger Fake-Audio-Inhalt: der Bytewert selbst ist ohne Bedeutung, nur seine blosse
// Existenz zaehlt (arrayBuffer() muss etwas liefern).
const PROBE_AUDIO_BYTES = [1];
const PROBE_PROVIDER = "telnyx";

/**
 * Die Fake-Konfiguration des Play-TTS-Pfads. Als Funktion, nicht als Konstante: die
 * Namespace-Getter haengen am Objekt, ein geteiltes Objekt liesse einen Spread-Override
 * eines Aufrufers auf alle anderen durchschlagen.
 * @returns {object}
 */
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
    },
  });
}

// Faengt die aufgerufene URL ein (die Voice-ID steckt darin) - ohne diesen Fake bliebe
// die Vorabsynthese unsichtbar getestet.
function recordingFetch() {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return {
      ok: true,
      headers: { get: () => "audio/mpeg" },
      arrayBuffer: async () => new Uint8Array(PROBE_AUDIO_BYTES).buffer,
    };
  };
  return { urls, fetchImpl };
}

/**
 * Fuehrt je Profil EINE sprechende Direktive durch die Vorabsynthese und liefert die
 * gerufenen Voice-IDs in derselben Reihenfolge.
 * @param {string[]} profiles VOICE_PROFILE-Werte
 * @returns {Promise<string[]>}
 */
export async function playTtsVoiceIdsFor(profiles) {
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: playTtsSynthConfig(),
    ttsStore: { put: () => PROBE_TOKEN },
    // No-op-Zaehler: diese Probe misst die STIMME, nicht die Zaehl-Semantik (die deckt
    // test/tts-quota-counter.test.js ab).
    store: { recordTtsCharacters: () => null },
    onQuotaWarning: () => assert.fail("onQuotaWarning gehoert nicht zu dieser Messung"),
  });
  const { urls, fetchImpl } = recordingFetch();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await synthesizeDirectiveAudio(
      { provider: PROBE_PROVIDER },
      profiles.map((profile) => say("Text", profile)),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(urls.length, profiles.length, "je Profil genau ein Synth-Aufruf");
  return urls.map((url) => url.match(/text-to-speech\/([^/?]+)/)[1]);
}

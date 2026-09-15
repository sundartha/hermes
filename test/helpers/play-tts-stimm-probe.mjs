// Der geteilte Harnisch der Play-TTS-Vorabsynthese: die Fake-Konfiguration, mit der die
// IP4-Tests makeDirectiveSynth verdrahten, und darauf aufgesetzt EIN Messwerkzeug fuer
// die Voice-ID, mit der diese Vorabsynthese ElevenLabs ruft. Die ID steckt im Pfad der
// Synthese-URL (src/tts/synth.js, TTS_PATH) - am beobachtbaren Ergebnis gemessen, nicht
// an einer Funktionssignatur.
//
// GETEILT von test/directive-synth.test.js (dort entstanden), test/ip4-stimm-anker.test.js,
// test/ip4-tts-kontingent.test.js (nur die Konfiguration) und
// test/iel-b7a-pflichtsatz-stimme.test.js (runPlayTtsProbe, injizierbarer Store). Zwei
// Kopien wuerden driften, und driftet eine, hoert genau eine der Suiten still auf zu
// messen (Muster test/helpers/elevenlabs-anrufstart-attrappe.mjs).
import assert from "node:assert/strict";
import { makeDirectiveSynth } from "../../src/tts/directive-synth.js";
import { say } from "../../src/telephony/directives.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
// IE7: die gestreamte Antwort-Attrappe ist geteilt - diese Datei hatte bis IE7 ihre eigene
// (recordingFetch), und zwei Kopien wuerden driften (S2).
import { recordingStreamFetch } from "./fake-tts-stream.mjs";

// Die GLOBALE Plattform-Stimme dieser Attrappe: bewusst ein Wert, der in KEINER
// kuratierten Profil-Karte steht - so faellt ein Rueckfall auf sie sofort auf.
export const PROBE_PLATTFORM_STIMME = "voice123";

const PROBE_PUBLIC_URL = "https://agent.test";
// Der Anbieter-Schluessel dieser Attrappe. Exportiert, damit der Kontingent-Test gegen
// GENAU diesen Wert pruefen kann, dass keine Warnzeile ihn traegt (Absolute Regel 4) -
// eine zweite Literalfassung dort koennte still an der Attrappe vorbeilaufen.
export const PROBE_API_KEY = "sk_test_should_never_leak";
const PROBE_TOKEN = "probe-token-abc";
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
      synthTotalTimeoutMs: 10000,
    },
  });
}

// No-op-Attrappen dieser Probe (G5: nur einmal geschrieben, an runPlayTtsProbe injiziert).
const PROBE_TTS_STORE = Object.freeze({ put: () => PROBE_TOKEN });
// No-op-Zaehler: die Probe misst die STIMME, nicht die Zaehl-Semantik (tts-quota-counter.test.js).
const PROBE_COUNTER_STORE = Object.freeze({ recordTtsCharacters: () => null });

/**
 * Fuehrt beliebige Direktiven durch die Vorabsynthese und liefert das Ergebnis samt der
 * gerufenen Voice-IDs (Reihenfolge der Synthese-Aufrufe). Stimme und Kontingent-Store sind
 * injizierbar; ohne Angabe gelten die No-op-Attrappen dieser Probe.
 * @param {object[]} directives
 * @param {{ttsStore?: object, store?: object}} [deps]
 * @returns {Promise<{out: object[], voiceIds: string[]}>}
 */
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

// IE7: der Streaming-Endpunkt haengt "/stream" HINTER die Voice-ID - der Ausdruck stoppt am naechsten "/".
function voiceIdOfSynthUrl(url) {
  return url.match(/text-to-speech\/([^/?]+)/)[1];
}

/**
 * Fuehrt je Profil EINE sprechende Direktive durch die Vorabsynthese und liefert die
 * gerufenen Voice-IDs in derselben Reihenfolge.
 * @param {string[]} profiles VOICE_PROFILE-Werte
 * @returns {Promise<string[]>}
 */
export async function playTtsVoiceIdsFor(profiles) {
  const { voiceIds } = await runPlayTtsProbe(profiles.map((profile) => say("Text", profile)));
  assert.equal(voiceIds.length, profiles.length, "je Profil genau ein Synth-Aufruf");
  return voiceIds;
}

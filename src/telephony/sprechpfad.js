// Der Sprechpfad EINES Inbound-Turns: EIN Namensvorrat fuer die drei TeXML-Formen und
// die EINE Ableitung, welchen Pfad diese Instanz scharf hat.
// Konsumenten JE FUNKTION:
//   SPRECHPFAD            -> alle drei unten
//   classifySprechpfad    -> scripts/inbound-hoerprobe.mjs (das Werkzeug misst die
//                            GERENDERTE Form) und test/ip2-sprechpfad-klassifikation.js
//   armedInboundSprechpfad-> src/boot.js (Banner-Zeile) und test/ip4-boot-sprechpfad
// UMZUG (IP4): bis IP2 lag beides in scripts/inbound-hoerprobe.mjs. Das Skript haengt an
// test/helpers.js (Server-Spawn) - boot.js haette den Test-Harness in den Produktions-
// prozess gezogen. Der Namensvorrat gehoert deshalb hierher, nicht ins Werkzeug.
// Rein: kein IO, kein config-Import (der Aufrufer reicht den Namespace herein, DIP).
export const SPRECHPFAD = Object.freeze({
  PLAY_TTS: "play_tts",
  AZURE_SAY: "azure_say",
  TELNYX_RELAY: "telnyx_relay",
});

// Reihenfolge = Prioritaet: <Play> ersetzt <Say> in render.js vollstaendig, die beiden
// <Say>-Formen unterscheiden sich nur am voice-Attribut-Praefix. telnyx_relay ist seit
// IP3 am echten Renderer nicht mehr erzeugbar - der Token klassifiziert eine TeXML-FORM,
// keinen lebenden Pfad.
const SPRECHPFAD_MATCHERS = Object.freeze([
  [SPRECHPFAD.PLAY_TTS, /<Play>/],
  [SPRECHPFAD.AZURE_SAY, /<Say voice="Azure\./],
  [SPRECHPFAD.TELNYX_RELAY, /<Say voice="ElevenLabs\./],
]);

/**
 * Der Sprechpfad EINES gerenderten TeXML-Dokuments. null = Grenzfall (leeres Gather ohne
 * Prompt) - am echten /voice/incoming nicht erreichbar, der Pflichtsatz erzeugt immer
 * Say/Play.
 * @param {string} texml
 * @returns {string|null} Token aus SPRECHPFAD
 */
export function classifySprechpfad(texml) {
  for (const [token, pattern] of SPRECHPFAD_MATCHERS) {
    if (pattern.test(texml)) return token;
  }
  return null;
}

/**
 * Welchen Inbound-Sprechpfad diese INSTANZ scharf hat - aus der aufgeloesten
 * Konfiguration, nicht aus einem Anruf.
 *
 * WAS DIESE FUNKTION NICHT BEHAUPTET (und die Banner-Zeile deshalb auch nicht): sie
 * faellt kein Urteil je Anruf. Ob ein einzelner Turn wirklich <Play> rendert, entscheidet
 * zusaetzlich die Anbieter-Faehigkeit (providerSupports PLAY_AUDIO_TTS), das
 * ElevenLabs-Kontingent und der Synthese-Erfolg - alle drei fallen fail-safe auf
 * azure_say zurueck (src/tts/directive-synth.js). Eine zweite Ableitung dieser drei
 * Bedingungen hier waere eine Kopie des Gates (G5).
 *
 * @param {{enabled: boolean}} elevenLabsPlayTts config.voice.elevenLabsPlayTts
 * @returns {string} SPRECHPFAD.PLAY_TTS | SPRECHPFAD.AZURE_SAY
 */
export function armedInboundSprechpfad(elevenLabsPlayTts) {
  return elevenLabsPlayTts.enabled ? SPRECHPFAD.PLAY_TTS : SPRECHPFAD.AZURE_SAY;
}

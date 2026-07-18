// Play-TTS-Direktiven-Synth (Server-Slim P2, reine Verschiebung aus server.js). Die Factory
// schliesst config + die EINE ttsStore-Instanz (INV-7); providerSupports/CAPABILITY
// (P5, registry.js)/DIRECTIVE/synthesizeSpeech importiert das Modul selbst (EINE Quelle
// je, G5). fetch bleibt das Node-Globale (NICHT importieren, sonst driftet der
// Timeout-Pfad gegen den Bestand).
//
// Play-TTS-Einwebung (fail-safe): synthetisiert die gesprochenen Texte einer Direktiven-
// Liste zur Webhook-Zeit (hartes Timeout in synthesizeSpeech), legt die Bytes in den
// ttsStore und webt die Serve-URL als audioUrl/promptAudioUrl ein -> der Telnyx-Renderer
// gibt <Play> statt <Say>. Flag AUS oder Nicht-Telnyx oder Synth-Fehler/Timeout -> Liste
// UNVERAENDERT zurueck -> Azure-<Say> byte-identisch (NIE den Call toeten). Genau EIN
// sprechender Text pro Turn -> genau ein Synth-Call pro Webhook.
import { synthesizeSpeech } from "./synth.js";
import { providerSupports, CAPABILITY } from "../telephony/registry.js";
import { DIRECTIVE } from "../telephony/directives.js";

export function makeDirectiveSynth({ config, ttsStore }) {
  async function synthesizeDirectiveAudio(call, directives) {
    const cfg = config.voice.elevenLabsPlayTts;
    if (!cfg.enabled || !providerSupports(call.provider, CAPABILITY.PLAY_AUDIO_TTS)) return directives;
    const out = [];
    for (const d of directives) out.push(await withPlayAudio(d, cfg));
    return out;
  }

  async function withPlayAudio(d, cfg) {
    const text = d.kind === DIRECTIVE.GATHER ? d.promptText : d.kind === DIRECTIVE.SAY ? d.text : "";
    if (!text) return d;
    const url = await synthToServeUrl(text, cfg);
    if (!url) return d; // fail-safe -> Azure-<Say>
    return d.kind === DIRECTIVE.GATHER ? { ...d, promptAudioUrl: url } : { ...d, audioUrl: url };
  }

  async function synthToServeUrl(text, cfg) {
    const result = await synthesizeSpeech(text, {
      fetchImpl: fetch,
      apiKey: cfg.apiKey,
      voiceId: cfg.voiceId,
      model: cfg.model,
      apiBase: cfg.apiBase,
      outputFormat: cfg.outputFormat,
      timeoutMs: cfg.synthTimeoutMs,
    });
    if (!result.ok) {
      // Beobachtbarkeit: stille Degradation auf Azure sichtbar machen (Betriebs-Symptom
      // "Call verbindet, aber Azure statt ElevenLabs"). reason ist ein grober Code
      // (http_<status>/timeout/error), NIE der Key/Secret.
      const detail = result.detail ? `: ${result.detail}` : "";
      console.warn(`[play-tts] Synth fehlgeschlagen (${result.reason}${detail}) -> Azure-Fallback`);
      return null;
    }
    const token = ttsStore.put(result.bytes, result.contentType);
    return `${config.server.publicUrl}/voice/tts/${token}`;
  }

  return { synthesizeDirectiveAudio };
}

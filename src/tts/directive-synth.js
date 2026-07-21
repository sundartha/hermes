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
//
// LCT P7 (Fixkosten sichtbar machen): store/onQuotaWarning sind injizierte Abhaengigkeiten
// (DIP/P15, wie config/ttsStore) - GENAU HIER, wo text VOR dem Aufruf und result.ok DANACH
// im selben Scope stehen, wird das ElevenLabs-Kontingent verbucht (die einzige Stelle, die
// unser Kontingent aus D7 belastet - der Telnyx-gehostete Relay-Pfad laeuft NICHT hier
// durch, s. Modul-Doc synth.js). NUR bei result.ok (der Fehlerpfad kehrt vorher zurueck) -
// ein Fehlschlag/Fallback zaehlt NICHT (der Zaehler soll die Wand vermessen, nicht
// ueberschaetzen). Kein await auf den Warn-Callback: der Webhook-Pfad darf nie auf den
// SMS-Versand warten (fire-and-forget liegt bereits in sendFailSoftAlertSms).
import { synthesizeSpeech } from "./synth.js";
import { providerSupports, CAPABILITY } from "../telephony/registry.js";
import { DIRECTIVE } from "../telephony/directives.js";

export function makeDirectiveSynth({ config, ttsStore, store, onQuotaWarning }) {
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
    const chars = text.length; // VOR dem Aufruf bekannt (LCT P7)
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
      // (http_<status>/timeout/error), NIE der Key/Secret. LCT P7: KEINE Verbuchung - der
      // Fehlerpfad/Azure-<Say>-Fallback zaehlt NICHT gegen das Kontingent.
      const detail = result.detail ? `: ${result.detail}` : "";
      console.warn(`[play-tts] Synth fehlgeschlagen (${result.reason}${detail}) -> Azure-Fallback`);
      return null;
    }
    // LCT P7: NUR bei result.ok verbuchen, platformweit (ausserhalb RLS, kein Gate liest es).
    const warning = store.recordTtsCharacters(chars, new Date().toISOString());
    if (warning) onQuotaWarning(warning);
    const token = ttsStore.put(result.bytes, result.contentType);
    return `${config.server.publicUrl}/voice/tts/${token}`;
  }

  return { synthesizeDirectiveAudio };
}

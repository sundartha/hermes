import { synthesizeSpeechStream } from "./synth.js";
import { providerSupports, CAPABILITY } from "../telephony/registry.js";
import { DIRECTIVE } from "../telephony/directives.js";
import { ttsQuotaExhausted } from "../store/state-ops.js";
import { elevenLabsVoiceIdFor } from "../telephony/adapters/telnyx/elevenlabs-voice.js";

export function makeDirectiveSynth({ config, ttsStore, store, onQuotaWarning }) {
  function warnQuotaDegradation({ characters, quota, cycleKey }) {
    console.warn(`[play-tts] Kontingent erschoepft (${characters}/${quota}, Zyklus ${cycleKey}) -> Azure-Fallback`);
  }

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
    const voiceId = d.voiceId || elevenLabsVoiceIdFor(cfg.voiceId, d.voiceProfile);
    const url = await synthToServeUrl(text, { ...cfg, voiceId });
    if (!url) return d;
    return d.kind === DIRECTIVE.GATHER ? { ...d, promptAudioUrl: url } : { ...d, audioUrl: url };
  }

  async function synthToServeUrl(text, cfg) {
    const nowIso = new Date().toISOString();
    const usage = store.platformTtsUsageView?.(nowIso);
    if (usage && ttsQuotaExhausted(usage)) {
      warnQuotaDegradation(usage);
      return null;
    }
    const chars = text.length;
    const result = await synthesizeSpeechStream(text, {
      fetchImpl: fetch,
      apiKey: cfg.apiKey,
      voiceId: cfg.voiceId,
      model: cfg.model,
      apiBase: cfg.apiBase,
      outputFormat: cfg.outputFormat,
      firstChunkTimeoutMs: cfg.synthTimeoutMs,
      totalTimeoutMs: cfg.synthTotalTimeoutMs,
    });
    if (!result.ok) {
      const detail = result.detail ? `: ${result.detail}` : "";
      console.warn(`[play-tts] Synth fehlgeschlagen (${result.reason}${detail}) -> Azure-Fallback`);
      return null;
    }
    const warning = store.recordTtsCharacters(chars, nowIso);
    if (warning?.exhausted) {
      warnQuotaDegradation(warning);
      return null;
    }
    if (warning) onQuotaWarning(warning);
    const token = ttsStore.put({ contentType: result.contentType, bytes: loggedAudioBytes(result) });
    return `${config.server.publicUrl}/voice/tts/${token}`;
  }

  async function loggedAudioBytes(result) {
    const audio = await result.audio;
    console.log(
      `[play-tts] Synthese ${audio.complete ? "vollstaendig" : "abgebrochen"} ` +
        `(erstes Audio ${result.firstChunkMs} ms, Gesamt ${audio.totalMs} ms)`,
    );
    return audio.bytes;
  }

  return { synthesizeDirectiveAudio };
}

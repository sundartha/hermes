import { synthesizeSpeechStream } from "./synth.js";
import { providerSupports, CAPABILITY } from "../telephony/registry.js";
import { DIRECTIVE } from "../telephony/directives.js";
import { ergebnisOderNull } from "../telephony/ergebnis-oder-null.js";
import { ttsQuotaExhausted } from "../store/state-ops.js";
import { elevenLabsVoiceIdFor } from "../telephony/adapters/telnyx/elevenlabs-voice.js";
import { PROVIDER_WEBHOOK_HARDCUT_MS, TURN_NETWORK_RESERVE_MS } from "../turn-budget.js";

const textDer = (direktive) => (direktive.kind === DIRECTIVE.GATHER ? direktive.promptText : direktive.text);

export function makeDirectiveSynth({ config, ttsStore, store, onQuotaWarning }) {
  function warnQuotaDegradation({ characters, quota, cycleKey }) {
    console.warn(`[play-tts] Kontingent erschoepft (${characters}/${quota}, Zyklus ${cycleKey}) -> Azure-Fallback`);
  }

  async function synthesizeDirectiveAudio(call, directives, eingangMs = Date.now()) {
    const cfg = config.voice.elevenLabsPlayTts;
    if (!cfg.enabled || !providerSupports(call.provider, CAPABILITY.PLAY_AUDIO_TTS)) return directives;
    const beendetAnruf = directives.some((direktive) => direktive.kind === DIRECTIVE.HANGUP);
    const abgabeMs = eingangMs + PROVIDER_WEBHOOK_HARDCUT_MS - TURN_NETWORK_RESERVE_MS;
    const ablage = beendetAnruf ? (result) => ablegenVollstaendig(result, abgabeMs) : ablegenStreamend;
    try {
      const out = [];
      for (const direktive of directives) out.push(await withPlayAudio(direktive, cfg, ablage));
      return out;
    } catch (err) {
      console.error(`[play-tts] Synthese geworfen (${err.message}) -> Azure-Fallback`);
      return directives;
    }
  }

  async function withPlayAudio(direktive, cfg, ablage) {
    const text = textDer(direktive);
    if (!text) return direktive;
    const voiceId = direktive.voiceId || elevenLabsVoiceIdFor(cfg.voiceId, direktive.voiceProfile);
    const url = await synthToServeUrl(text, { ...cfg, voiceId }, ablage);
    if (!url) return direktive;
    return direktive.kind === DIRECTIVE.GATHER
      ? { ...direktive, promptAudioUrl: url }
      : { ...direktive, audioUrl: url };
  }

  async function synthToServeUrl(text, cfg, ablage) {
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
    return ablage(result);
  }

  function ablegenStreamend(result) {
    return legeAb(result, loggedAudio(result));
  }

  async function ablegenVollstaendig(result, abgabeMs) {
    const audio = loggedAudio(result);
    const fertig = await ergebnisOderNull(audio, abgabeMs - Date.now());
    if (fertig === null || !fertig.complete) {
      console.warn("[play-tts] Satz vor dem Auflegen unvollstaendig oder zu spaet -> Azure-Fallback");
      return null;
    }
    return legeAb(result, audio);
  }

  function legeAb(result, audio) {
    const token = ttsStore.put({ contentType: result.contentType, bytes: audio.then((fertig) => fertig.bytes) });
    return `${config.server.publicUrl}/voice/tts/${token}`;
  }

  async function loggedAudio(result) {
    const audio = await result.audio;
    console.log(
      `[play-tts] Synthese ${audio.complete ? "vollstaendig" : "abgebrochen"} ` +
        `(erstes Audio ${result.firstChunkMs} ms, Gesamt ${audio.totalMs} ms)`,
    );
    return audio;
  }

  return { synthesizeDirectiveAudio };
}

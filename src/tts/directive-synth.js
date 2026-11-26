import { AGENT_STIMME } from "../conversation/elevenlabs-agent-config.ts";
import { anfrage } from "../utils/anfrage.ts";
import { synthesizeSpeechStream } from "./synth.ts";
import { providerSupports, CAPABILITY } from "../telephony/registry.js";
import { DIRECTIVE } from "../telephony/directives.ts";
import { ergebnisOderNull } from "../telephony/ergebnis-oder-null.ts";
import { ttsQuotaExhausted } from "../store/state-ops.js";
import { EINE_STIMME_ID } from "../elevenlabs/stimme-festlegen.ts";
import { PROVIDER_WEBHOOK_HARDCUT_MS, TURN_NETWORK_RESERVE_MS } from "../turn-budget.ts";

const synthOptionen = (cfg) => ({
  fetchImpl: anfrage,
  apiKey: cfg.apiKey,
  voiceId: cfg.voiceId,
  model: cfg.model,
  voiceSettings: cfg.voiceSettings,
  apiBase: cfg.apiBase,
  outputFormat: cfg.outputFormat,
  firstChunkTimeoutMs: cfg.synthTimeoutMs,
  totalTimeoutMs: cfg.synthTotalTimeoutMs,
});

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
    const ablage = beendetAnruf ? (result) => ablegenVollstaendig(result, abgabeMs) : (result) => ablegenStreamend(result, abgabeMs);
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
    const voiceId = direktive.voiceId || EINE_STIMME_ID;
    const url = await synthToServeUrl(text, { ...cfg, voiceId }, ablage);
    if (!url) return direktive;
    return direktive.kind === DIRECTIVE.GATHER
      ? { ...direktive, promptAudioUrl: url }
      : { ...direktive, audioUrl: url };
  }

  async function synthToServeUrl(text, cfg, ablage) {
    const nowIso = new Date().toISOString();
    const usage = await store.platformTtsUsageView?.(nowIso);
    if (usage && ttsQuotaExhausted(usage)) {
      warnQuotaDegradation(usage);
      return null;
    }
    const chars = text.length;
    const result = await synthesizeSpeechStream(text, synthOptionen(cfg));
    if (!result.ok) {
      const { reason = result.fehler, detail } = result.fehler;
      const zusatz = detail ? `: ${detail}` : "";
      console.warn(`[play-tts] Synth fehlgeschlagen (${reason}${zusatz}) -> Azure-Fallback`);
      return null;
    }
    const warning = await store.recordTtsCharacters(chars, nowIso);
    if (warning?.exhausted) {
      warnQuotaDegradation(warning);
      return null;
    }
    if (warning) onQuotaWarning(warning);
    return ablage(result.wert);
  }

  async function synthesizeVorspann(text, voiceId) {
    const nowIso = new Date().toISOString();
    if (ttsQuotaExhausted(await store.platformTtsUsageView(nowIso))) return { quotaErschoepft: true };
    const stimme = {
      ...config.voice.elevenLabsPlayTts,
      voiceId,
      ...(AGENT_STIMME.model ? { model: AGENT_STIMME.model } : {}),
      ...(AGENT_STIMME.voiceSettings ? { voiceSettings: AGENT_STIMME.voiceSettings } : {}),
    };
    const result = await synthesizeSpeechStream(text, synthOptionen(stimme));
    if (!result.ok) return result;
    const warning = await store.recordTtsCharacters(text.length, nowIso);
    if (warning?.exhausted) return { quotaErschoepft: true };
    if (warning) onQuotaWarning(warning);
    return result;
  }

  function ablegenStreamend(result, abgabeMs) {
    return legeAb(result, loggedAudio(result), abgabeMs);
  }

  async function ablegenVollstaendig(result, abgabeMs) {
    const audio = loggedAudio(result);
    const fertig = await ergebnisOderNull(audio, abgabeMs - Date.now());
    if (fertig === null || !fertig.complete) {
      console.warn("[play-tts] Satz vor dem Auflegen unvollstaendig oder zu spaet -> Azure-Fallback");
      return null;
    }
    return legeAb(result, audio, abgabeMs);
  }

  async function legeAb(result, audio, abgabeMs) {
    const ablegen = Promise.resolve(ttsStore.put({ contentType: result.contentType, bytes: audio.then((fertig) => fertig.bytes) }));
    const token = await ergebnisOderNull(ablegen, abgabeMs - Date.now());
    if (token === null) {
      console.warn("[play-tts] Ablage zu spaet -> Azure-Fallback");
      return null;
    }
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

  return { synthesizeDirectiveAudio, synthesizeVorspann };
}

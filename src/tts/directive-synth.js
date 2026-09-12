// Play-TTS-Direktiven-Synth (Server-Slim P2, reine Verschiebung aus server.js). Die Factory
// schliesst config + die EINE ttsStore-Instanz (INV-7); providerSupports/CAPABILITY
// (P5, registry.js)/DIRECTIVE/synthesizeSpeech importiert das Modul selbst (EINE Quelle
// je, G5). fetch bleibt das Node-Globale (NICHT importieren, sonst driftet der
// Timeout-Pfad gegen den Bestand).
//
// Play-TTS-Einwebung (fail-safe): synthetisiert die gesprochenen Texte einer Direktiven-
// Liste zur Webhook-Zeit (hartes Timeout in synthesizeSpeech), legt die Bytes in den
// ttsStore und webt die Serve-URL als audioUrl/promptAudioUrl ein -> der Telnyx-Renderer
// gibt <Play> statt <Say>. Flag AUS oder Nicht-Telnyx oder Synth-Fehler/Timeout oder
// erschoepftes ElevenLabs-Kontingent (GAP-09) -> Liste UNVERAENDERT zurueck -> Azure-<Say>
// byte-identisch (NIE den Call toeten). Genau EIN sprechender Text pro Turn -> genau ein
// Synth-Call pro Webhook.
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
import { ttsQuotaExhausted } from "../store/state-ops.js";
import { elevenLabsVoiceIdFor } from "../telephony/adapters/telnyx/elevenlabs-voice.js";

export function makeDirectiveSynth({ config, ttsStore, store, onQuotaWarning }) {
  // Beobachtbarkeit: die Degradation darf nicht still ausfallen (Betriebs-Symptom "Anruf
  // verbindet, aber Azure statt ElevenLabs"). Gleiche Form wie der Synth-Fehlerpfad
  // daneben: Zahlen und Zyklus, NIE Key/Secret. EINE Log-Form fuer beide Riegel (G5).
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
    // P9/IP3: EINZIGER sprachaufgeloester Sprechpfad der Budget-Engine. Bis IP3 loeste
    // auch der <Say>-Renderer sprachabhaengig auf; mit dem entfernten Relay-Zweig ist
    // diese Stelle hier die letzte - deshalb liegt der Katalog-Messpunkt VOICE-12 seit
    // IP3 an ihr (test/directive-synth.test.js). elevenLabsVoiceIdFor bleibt die EINE
    // Aufloesungsquelle, geteilt mit dem Outbound-Anrufstart (G5).
    const voiceId = elevenLabsVoiceIdFor(cfg.voiceId, d.voiceProfile);
    const url = await synthToServeUrl(text, { ...cfg, voiceId });
    if (!url) return d; // fail-safe -> Azure-<Say>
    return d.kind === DIRECTIVE.GATHER ? { ...d, promptAudioUrl: url } : { ...d, audioUrl: url };
  }

  async function synthToServeUrl(text, cfg) {
    const nowIso = new Date().toISOString(); // EIN Zeitpunkt fuer Riegel UND Buchung
    // GAP-09 Vorab-Riegel: ist das Kontingent bereits erschoepft, wird ElevenLabs gar nicht
    // erst gerufen - der Anruf laeuft mit Azure-<Say> weiter (Degradation, KEINE Sperre).
    // Zaehler UND Kontingent kommen aus DERSELBEN Projektion (G5, kein zweiter
    // Wahrheitsanker, kein config-Zugriff hier) und sind unabhaengig von der Warn-Schwelle.
    // Optional gelesen: platformTtsUsageView liegt auf der Store-Fassade (store.js
    // re-exportiert sie), die Bestands-Test-Fakes des Zaehl-Seams kennen aber nur den
    // Schreiber - fehlt die Projektion, faengt der Nach-Buchungs-Riegel unten.
    const usage = store.platformTtsUsageView?.(nowIso);
    if (usage && ttsQuotaExhausted(usage)) {
      warnQuotaDegradation(usage);
      return null; // erschoepft heisst NICHT bezahlen -> kein Provider-Aufruf
    }
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
    const warning = store.recordTtsCharacters(chars, nowIso);
    // GAP-09 Nach-Buchungs-Riegel: diese Buchung war reine Overage -> Audio verwerfen,
    // Direktive bleibt unveraendert -> Azure-<Say>. KEIN onQuotaWarning: diese Meldung
    // kommt bei JEDEM Aufruf (sie ist der Riegel, nicht der Alarm) - alarmiert wuerde
    // eine SMS je Turn. Der Alarm ist die warn-once-Schwelle darunter.
    if (warning?.exhausted) {
      warnQuotaDegradation(warning);
      return null;
    }
    if (warning) onQuotaWarning(warning);
    const token = ttsStore.put(result.bytes, result.contentType);
    return `${config.server.publicUrl}/voice/tts/${token}`;
  }

  return { synthesizeDirectiveAudio };
}

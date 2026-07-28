// Telnyx-Adapter: EINE Quelle fuer das ElevenLabs-Voice-Format und das Vollstaendigkeits-
// Gate der Plattform-Stimme. Genutzt vom TeXML-Renderer (render.js), vom Call-Control-
// speak (voice.js) und vom Assistant-Provisioner (scripts/) - kein Wert-Duplikat (G5/S2).
// Rein: kein IO, kein config-Import (der Aufrufer reicht die Registry-Werte herein).
import { VOICE_PROFILE } from "../../directives.js";

const ELEVENLABS_PROVIDER = "ElevenLabs";
// Telnyx-Model-Slot-Default in <Provider>.<Model>.<VoiceId> (Telnyx dokumentiert "Default").
const DEFAULT_MODEL = "Default";

// Sprach-aufgeloeste ElevenLabs-Stimmen (Owner-Entscheidung 2026-07-27, bindende IDs).
// Kuratierte Produkt-Daten auf derselben Schicht wie die Azure-/Polly-Voice-Namen im
// Renderer - bewusst KEIN Env-Schalter (G35 greift fuer konfigurierbare Werte; diese
// sind es nicht: eine falsch gesetzte ID laesst den Agenten in der falschen Stimme
// sprechen, ohne dass ein Test oder ein Boot-Guard das sieht).
// DE fehlt hier ABSICHTLICH: Deutsch bleibt die global konfigurierte Plattform-Stimme
// (TELNYX_ELEVENLABS_VOICE_ID) - die heute live gesprochene Stimme aendert sich NICHT.
// EN = en-GB, der Default fuer Englisch. Die US-Stimme ist NICHT eingetragen: es gibt
// heute keinen Pfad, der ein en-US-Locale aufloest - eine ID ohne Leser waere tote Daten.
const ELEVENLABS_VOICE_ID_BY_PROFILE = Object.freeze({
  [VOICE_PROFILE.FR_FEMALE_NEURAL]: "FFXYdAYPzn8Tw8KiHZqg",
  [VOICE_PROFILE.EN_FEMALE_NEURAL]: "wOPou4MhRIYEqQHVxjmp",
});

/** Reines Namensformat <Provider>.<Model>.<VoiceId>. @param {{voiceId: string, model?: string}} el */
export function elevenLabsVoiceName(el) {
  return `${ELEVENLABS_PROVIDER}.${el.model || DEFAULT_MODEL}.${el.voiceId}`;
}

// Sprach-aufgeloeste rohe Voice-ID: Profil mit eigener Stimme -> diese, sonst die
// injizierte Plattform-Stimme (DE). EINE Aufloesungsstelle fuer beide Konsumenten
// (Renderer-Voice-Name unten UND der Play-TTS-Vorabsynthese-Pfad in src/tts/*, der
// dieselbe Aufloesung braucht statt einer zweiten globalen Stimme, G5/S2).
export function elevenLabsVoiceIdFor(defaultVoiceId, voiceProfile) {
  return ELEVENLABS_VOICE_ID_BY_PROFILE[voiceProfile] || defaultVoiceId;
}

// Sprach-aufgeloester Voice-Name: Komposition aus der ID-Aufloesung + Namensformat
// (kein zweiter Formatierungs- oder Aufloesungsort, G5).
export function elevenLabsVoiceNameFor(el, voiceProfile) {
  return elevenLabsVoiceName({ model: el.model, voiceId: elevenLabsVoiceIdFor(el.voiceId, voiceProfile) });
}

// Fail-SAFE-Gate (kein Programmierfehler, anders als das werfende voiceAttrs): eine halbe/
// leere Env ist ein Betriebszustand -> Azure-Bestand statt totem Call. Beide Pflichtteile
// noetig: ohne voiceId gibt es keine Stimme, ohne apiKeyRef keinen ElevenLabs-Zugang.
export function hasElevenLabsVoice(el) {
  return Boolean(el && el.voiceId && el.apiKeyRef);
}

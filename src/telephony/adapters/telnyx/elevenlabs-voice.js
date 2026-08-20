// Telnyx-Adapter: EINE Quelle fuer das ElevenLabs-Voice-Format und das Vollstaendigkeits-
// Gate der Plattform-Stimme. Genutzt vom TeXML-Renderer (render.js), vom Call-Control-
// speak (voice.js) und vom Assistant-Provisioner (scripts/) - kein Wert-Duplikat (G5/S2).
// Rein: kein IO, kein config-Import (der Aufrufer reicht die Registry-Werte herein).
import { VOICE_PROFILE } from "../../directives.js";

const ELEVENLABS_PROVIDER = "ElevenLabs";
// Telnyx-Model-Slot-Default in <Provider>.<Model>.<VoiceId> (Telnyx dokumentiert "Default").
const DEFAULT_MODEL = "Default";

// Sprach-aufgeloeste ElevenLabs-Stimmen (Owner-Entscheidung 2026-08-18, bindende IDs -
// vom Eigentuemer selbst angehoert und ausgewaehlt). Kuratierte Produkt-Daten auf
// derselben Schicht wie die Azure-/Polly-Voice-Namen im Renderer - bewusst KEIN
// Env-Schalter (G35 greift fuer konfigurierbare Werte; diese sind es nicht: eine falsch
// gesetzte ID laesst den Agenten in der falschen Stimme sprechen, ohne dass ein Test oder
// ein Boot-Guard das sieht).
//
// DE IST NEU UND SCHLIESST EIN LOCH. Bis 2026-08-18 fehlte Deutsch hier ABSICHTLICH und
// fiel auf die Plattform-Stimme (TELNYX_ELEVENLABS_VOICE_ID) zurueck. Am ElevenLabs-Weg
// ist dieser Wert lokal nie gesetzt gewesen -> leerer Override -> es wurde GAR KEINE
// Stimme gesetzt, und der Agent sprach mit seiner Dashboard-Stimme. GEMESSEN an Anruf 7
// (18.08.2026): ein deutsches Gespraech in "Spuds Oxley", Anbieter-Label
// en/american/male/old. Ein Amerikaner, der Deutsch spricht. Mit einem eigenen DE-Eintrag
// haengt die Stimme nicht mehr daran, ob irgendwo eine Env gesetzt ist.
//
// KEINE US-STIMME, und das ist eine Entscheidung, keine Luecke (Eigentuemer 2026-08-18):
// Englisch ist der Weltdefault fuer alles ausser dem deutsch- und franzoesischsprachigen
// Raum, und zwischen amerikanisch und dem Rest wird vorerst NICHT unterschieden.
//
// PRUEFEN DIESER IDs, falls sie je jemand anzweifelt: NICHT ueber GET /v1/voices/{id} -
// dieser Endpunkt kennt nur Workspace-Stimmen und meldet fuer Bibliotheks-Stimmen
// "voice_not_found", obwohl sie einwandfrei sprechen (am 18.08.2026 an allen fuenf IDs
// gemessen, alte wie neue). Die einzige belastbare Probe ist eine winzige Synthese
// (POST /v1/text-to-speech/{id}); die liefert 200 fuer genau die IDs, die die Liste
// nicht kennt.
const ELEVENLABS_VOICE_ID_BY_PROFILE = Object.freeze({
  [VOICE_PROFILE.DE_FEMALE_NEURAL]: "cqPdIo76zSHFDcSZpFov",
  [VOICE_PROFILE.FR_FEMALE_NEURAL]: "WeAAwKYcS06VmXw086yZ",
  [VOICE_PROFILE.EN_FEMALE_NEURAL]: "ZSNL4hPqCnqoMPaI4jGX",
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

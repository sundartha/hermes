// Telnyx-Adapter: EINE Quelle fuer das ElevenLabs-Voice-Format und das Vollstaendigkeits-
// Gate der Plattform-Stimme. Genutzt vom TeXML-Renderer (render.js), vom Call-Control-
// speak (voice.js) und vom Assistant-Provisioner (scripts/) - kein Wert-Duplikat (G5/S2).
// Rein: kein IO, kein config-Import (der Aufrufer reicht die Registry-Werte herein).
const ELEVENLABS_PROVIDER = "ElevenLabs";
// Telnyx-Model-Slot-Default in <Provider>.<Model>.<VoiceId> (Telnyx dokumentiert "Default").
const DEFAULT_MODEL = "Default";

/** @param {{voiceId: string, model?: string}} el */
export function elevenLabsVoiceName(el) {
  return `${ELEVENLABS_PROVIDER}.${el.model || DEFAULT_MODEL}.${el.voiceId}`;
}

// Fail-SAFE-Gate (kein Programmierfehler, anders als das werfende voiceAttrs): eine halbe/
// leere Env ist ein Betriebszustand -> Azure-Bestand statt totem Call. Beide Pflichtteile
// noetig: ohne voiceId gibt es keine Stimme, ohne apiKeyRef keinen ElevenLabs-Zugang.
export function hasElevenLabsVoice(el) {
  return Boolean(el && el.voiceId && el.apiKeyRef);
}

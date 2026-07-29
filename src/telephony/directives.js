// Neutrale Call-Direktiven (provider-unabhaengig). Der Core (server.js) baut eine
// Liste solcher Direktiven; der Adapter (renderDirectives) uebersetzt sie in
// TwiML/TeXML. Voice-Namen (Polly...) verlassen den Core nie - hier steht nur
// der LOGISCHE Profilname.

// Logische Voice-Profile. Der Adapter mappt sie auf provider-spezifische
// Voice-Bezeichner. Werte sind deckungsgleich mit src/i18n/locales.js
// (VOICE_PROFILE_DE/_FR) - dort waehlt das Locale-Bundle das Profil pro Sprache,
// hier stehen die kanonischen Enum-Werte (eine Quelle, kein Drift).
export const VOICE_PROFILE = Object.freeze({
  DE_FEMALE_NEURAL: "de-female-neural",
  FR_FEMALE_NEURAL: "fr-female-neural",
  EN_FEMALE_NEURAL: "en-female-neural",
});

// Direktiven-Typen (neutrales Enum statt Magic Strings, G25/G16).
export const DIRECTIVE = Object.freeze({
  SAY: "say",
  GATHER: "gather", // Sprach-Eingabe einsammeln; optionaler Prompt + Folge-Action
  HANGUP: "hangup",
  REDIRECT: "redirect",
  STREAM: "stream", // Realtime: Media-Stream an die Bridge
  PAUSE: "pause", // Stille halten (Sekunden), ohne aufzulegen
});

// --- Builder (intentions-ausdrueckende Namen, <=3 Args via Objekt-Param) ---

// Gesprochener Satz. voiceProfile ist ein VOICE_PROFILE-Wert.
// audioUrl (optional): vorab synthetisierte Audiodatei (Play-TTS-Seam, server.js).
// Gesetzt -> der Renderer gibt <Play>url</Play> statt <Say>text</Say> aus. Weglassen
// -> byte-identisch zum <Say>-Bestand.
export const say = (text, voiceProfile = VOICE_PROFILE.DE_FEMALE_NEURAL, audioUrl) => ({
  kind: DIRECTIVE.SAY,
  text,
  voiceProfile,
  audioUrl,
});

// Sprach-Turn: optionaler Prompt (say im Gather) + Action-URL fuers Ergebnis.
// promptText leer -> Gather ohne inneren Say (Bestandsverhalten gatherTurn).
// speechTimeoutSec (optional, Sekunden): festes STT-Endpointing statt provider-Default
// "auto" - gesetzt nur fuer Folge-Gathers (/voice/turn), nicht fuer den Erst-Gather.
// Weglassen -> Renderer bleibt byte-identisch beim "auto"-Bestand.
// promptAudioUrl (optional): wie audioUrl bei say, aber fuer den inneren Gather-Prompt
// (<Play> statt innerem <Say>). Weglassen -> byte-identisch (Muster speechTimeoutSec).
export const gather = ({
  promptText,
  action,
  voiceProfile = VOICE_PROFILE.DE_FEMALE_NEURAL,
  speechTimeoutSec,
  promptAudioUrl,
}) => ({
  kind: DIRECTIVE.GATHER,
  promptText,
  action,
  voiceProfile,
  speechTimeoutSec,
  promptAudioUrl,
});

export const hangup = () => ({ kind: DIRECTIVE.HANGUP });

// Stille von `seconds` Sekunden, ohne den Leg zu beenden. Einziger Aufrufer ist heute
// die AL-P2b-Wegwerf-Route (abnehmen und schweigen); der Wert kommt vom Aufrufer aus
// config (G35), nie als Literal aus dem Renderer.
export const pause = (seconds) => ({ kind: DIRECTIVE.PAUSE, seconds });

export const redirect = (url) => ({ kind: DIRECTIVE.REDIRECT, url });

// Realtime-Media-Stream. params = [{name, value}, ...] (call_id, stream_token).
export const stream = ({ url, params }) => ({ kind: DIRECTIVE.STREAM, url, params });

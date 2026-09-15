// Neutrale Call-Direktiven (provider-unabhaengig). Der Core (server.js) baut eine
// Liste solcher Direktiven; der Adapter (renderDirectives) uebersetzt sie in
// TwiML/TeXML. Voice-Namen (Polly...) verlassen den Core nie - hier steht nur
// der LOGISCHE Profilname. Einzige Ausnahme: das optionale Feld voiceId (IEL-B7a/E19),
// eine rohe ElevenLabs-Stimm-ID fuer die Play-TTS-Vorabsynthese. Der Renderer liest es
// nicht; ohne Feld hat jede Direktive exakt die Bestandsform.

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
  DIAL_SIP: "dial_sip", // IEL-B7: Anruf an eine SIP-Gegenstelle ueberbruecken
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

// IEL-B7a (E19): voiceId entsteht NUR mit nichtleerem String. Leer oder fehlend -> kein
// Feld, die Direktive behaelt ihre Bestandsform (deepStrictEqual-gleich, B8: "bei leerem
// Wert kein Feld"). Eine Quelle fuer say und gather (G5).
const voiceIdField = (voiceId) => (typeof voiceId === "string" && voiceId.length > 0 ? { voiceId } : {});

// IEL-B7a (E19): gesprochener Satz in einer ausdruecklich gewaehlten ElevenLabs-Stimme
// (EL-Inbound: Fehlersatz in der Stimme des Agenten). Objekt-Parameter
// statt eines 4. Positionsarguments an say (F1). voiceProfile bleibt fuer den Azure-Rueckfall
// und die Sprach-Pflicht-Logik von say (undefined -> say-Default).
export const sayWithVoiceId = ({ text, voiceProfile, voiceId }) => ({
  ...say(text, voiceProfile),
  ...voiceIdField(voiceId),
});

// Sprach-Turn: optionaler Prompt (say im Gather) + Action-URL fuers Ergebnis.
// promptText leer -> Gather ohne inneren Say (Bestandsverhalten gatherTurn).
// speechTimeoutSec (optional, Sekunden): festes STT-Endpointing statt provider-Default
// "auto" - gesetzt nur fuer Folge-Gathers (/voice/turn), nicht fuer den Erst-Gather.
// Weglassen -> Renderer bleibt byte-identisch beim "auto"-Bestand.
// promptAudioUrl (optional): wie audioUrl bei say, aber fuer den inneren Gather-Prompt
// (<Play> statt innerem <Say>). Weglassen -> byte-identisch (Muster speechTimeoutSec).
// voiceId (optional, IEL-B7a/E19): wie bei sayWithVoiceId; weglassen oder "" -> byte-identisch.
export const gather = ({
  promptText,
  action,
  voiceProfile = VOICE_PROFILE.DE_FEMALE_NEURAL,
  speechTimeoutSec,
  promptAudioUrl,
  voiceId,
}) => ({
  kind: DIRECTIVE.GATHER,
  promptText,
  action,
  voiceProfile,
  speechTimeoutSec,
  promptAudioUrl,
  ...voiceIdField(voiceId),
});

export const hangup = () => ({ kind: DIRECTIVE.HANGUP });

export const redirect = (url) => ({ kind: DIRECTIVE.REDIRECT, url });

// IEL-B7 (L1/E9): Bruecke an eine SIP-Gegenstelle mit Digest-Zugang. Neutral: Sekunden als
// Zahl, die zulaessigen Grenzen des Anbieters setzt der Adapter (Renderer). statusCallbackUrl
// empfaengt das answered-Ereignis des SIP-Beins. password ist SECRET - Direktiven werden nie
// geloggt, nur gerendert.
export const dialSip = ({ uri, username, password, callerId, timeoutS, timeLimitS, statusCallbackUrl }) => ({
  kind: DIRECTIVE.DIAL_SIP,
  uri,
  username,
  password,
  callerId,
  timeoutS,
  timeLimitS,
  statusCallbackUrl,
});

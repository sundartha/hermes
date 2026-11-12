export const VOICE_LANGS = Object.freeze(["en"]);

export const VOICE_MODEL = "eleven_v4_turbo";

export const VOICE_ROLES = Object.freeze({
  hermes: Object.freeze({ voiceId: "EXAVITQu4vr4xnSDxMaL", source: "ElevenLabs premade voice library" }),
});

export const VOICE_SPEAKERS = Object.freeze({
  en: Object.freeze({ hermes: "Hermes", anna: "Anna", mara: "Mara", salon: "Salon Mia" }),
});

const SPAN_SEPARATOR = "-";
const VIA_SEPARATOR = "/";
const VIA_PHONE = "phone";
const VIA_CLIP = "clip";

function cue(span, speaker, text) {
  const [at, until] = span.split(SPAN_SEPARATOR).map(Number);
  const [who, via] = speaker.split(VIA_SEPARATOR);
  return Object.freeze({ at, until, who, text, line: via === VIA_PHONE, filmed: via === VIA_CLIP });
}

export const VOICE_SCRIPT = Object.freeze({
  uc1: Object.freeze({
    duration: "17.125",
    en: Object.freeze([
      cue("0.0-3.1", "mara/clip", "Everyone is aligned. Our main focus will be on team efficiency."),
      cue("3.2-6.15", "hermes/phone", "Hermes, Mara's AI assistant."),
      cue("6.2-9.25", "anna/clip", "Could you tell her the contract is ready? She can call me back after four."),
      cue("9.28-10.17", "hermes/phone", "Will do."),
      cue("10.2-11.4", "anna/clip", "Perfect. Thank you. Bye."),
    ]),
  }),
  uc2: Object.freeze({
    duration: "21.958",
    en: Object.freeze([
      cue("0.95-2.25", "anna/clip", "Hi, it's Anna Berger."),
      cue("2.95-5.0", "anna/clip", "I'd love to book a meeting with Mara next week."),
      cue("5.7-6.95", "anna/clip", "Is Thursday morning possible?"),
      cue("7.2-9.0", "hermes/phone", "Let me check her calendar."),
      cue("9.1-11.2", "hermes/phone", "Thursday morning is taken."),
      cue("11.3-13.7", "hermes/phone", "How about 14:30?"),
      cue("14.2-17.0", "hermes/phone", "Booked. You'll get a confirmation."),
    ]),
  }),
  uc3: Object.freeze({
    duration: "12.542",
    en: Object.freeze([
      cue("1.0-3.9", "hermes/phone", "Hermes here, Mara's AI assistant."),
      cue("3.9-5.1", "salon/clip", "Thursday at 10 is free."),
      cue("5.75-6.4", "salon/clip", "It is booked."),
      cue("6.6-7.9", "hermes/phone", "Thank you!"),
    ]),
  }),
  uc4: Object.freeze({
    duration: "7.5",
    en: Object.freeze([]),
  }),
});

export const clipDuration = (clip) => Number(VOICE_SCRIPT[clip].duration);

export const voiceAudioFile = (clip, lang) => `${clip}-${lang}.m4a`;
export const voiceCaptionFile = (clip, lang) => `${clip}-${lang}.vtt`;
export const voiceBedFile = (clip) => `${clip}.m4a`;

// Desktop-Fassung in 1080p (aus den 720p-Mastern hochgerechnet und nachgeschärft); sie trägt dieselbe Tonspur.
export const VIDEO_WIDE_SUFFIX = "-1080";
const VIDEO_SIZES = ["", VIDEO_WIDE_SUFFIX];

export const voiceVideoFiles = (clip) =>
  VIDEO_SIZES.flatMap((size) => [`${clip}${size}.av1.mp4`, `${clip}${size}.mp4`, `${clip}-de${size}.av1.mp4`, `${clip}-de${size}.mp4`]);

export function voiceFilesFor(clip) {
  return VOICE_LANGS.map((lang) => voiceCaptionFile(clip, lang));
}

const spokenChars = (lines) => lines.reduce((chars, line) => chars + (line.filmed ? 0 : line.text.length), 0);

export function voiceCharacters() {
  return Object.values(VOICE_SCRIPT).reduce((sum, clip) => sum + VOICE_LANGS.reduce((inner, lang) => inner + spokenChars(clip[lang]), 0), 0);
}

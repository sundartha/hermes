export const VOICE_LANGS = Object.freeze(["en", "de"]);

export const VOICE_MODEL = "eleven_v4_turbo";

export const VOICE_ROLES = Object.freeze({
  hermes: Object.freeze({ voiceId: "NOpBlnGInO9m6vDvFkFC", source: "elevenlabs/agent_configs/outbound-agent.template.json" }),
  anna: Object.freeze({ voiceId: "EXAVITQu4vr4xnSDxMaL", source: "ElevenLabs premade voice library" }),
  salon: Object.freeze({ voiceId: "XrExE9yKIg1WjnnlVkGX", source: "ElevenLabs premade voice library" }),
});

export const VOICE_SPEAKERS = Object.freeze({
  en: Object.freeze({ hermes: "Hermes", anna: "Anna", salon: "Salon Mia" }),
  de: Object.freeze({ hermes: "Hermes", anna: "Anna", salon: "Salon Mia" }),
});

const SPAN_SEPARATOR = "-";
const VIA_SEPARATOR = "/";
const VIA_PHONE = "phone";

function cue(span, speaker, text) {
  const [at, until] = span.split(SPAN_SEPARATOR).map(Number);
  const [who, via] = speaker.split(VIA_SEPARATOR);
  return Object.freeze({ at, until, who, text, line: via === VIA_PHONE });
}

export const VOICE_SCRIPT = Object.freeze({
  uc1: Object.freeze({
    duration: "17.125",
    en: Object.freeze([
      cue("4.6-6.9", "hermes/phone", "Hermes here, Mara's AI assistant."),
      cue("7.0-12.4", "anna", "Tell Mara the contract is ready. She can call me back after 4 pm."),
      cue("12.5-14.2", "hermes/phone", "I'll let her know."),
    ]),
    de: Object.freeze([
      cue("4.6-6.9", "hermes/phone", "Hermes hier, Maras KI-Assistent."),
      cue("7.0-12.4", "anna", "Sag Mara, der Vertrag ist fertig. Sie kann mich nach 16 Uhr zurückrufen."),
      cue("12.5-14.2", "hermes/phone", "Ich richte es ihr aus."),
    ]),
  }),
  uc2: Object.freeze({
    duration: "21.958",
    en: Object.freeze([
      cue("0.5-6.7", "anna", "Hi, it's Anna from Berger & Co. Could I get half an hour with Mara this week?"),
      cue("6.9-8.7", "hermes/phone", "Let me check her calendar."),
      cue("8.8-10.5", "hermes/phone", "Wednesday is fully booked."),
      cue("10.55-12.5", "hermes/phone", "Thursday, 14:30 instead?"),
      cue("12.55-14.0", "anna", "Thursday works."),
      cue("14.1-16.6", "hermes/phone", "Booked. You'll get a confirmation."),
    ]),
    de: Object.freeze([
      cue("0.5-6.7", "anna", "Hallo, hier ist Anna von Berger & Co. Hätte Mara diese Woche eine halbe Stunde für mich?"),
      cue("6.9-8.7", "hermes/phone", "Ich schaue in ihren Kalender."),
      cue("8.8-10.5", "hermes/phone", "Mittwoch ist ausgebucht."),
      cue("10.55-12.5", "hermes/phone", "Donnerstag, 14:30 Uhr?"),
      cue("12.55-14.0", "anna", "Donnerstag passt."),
      cue("14.1-16.6", "hermes/phone", "Gebucht. Die Bestätigung kommt gleich."),
    ]),
  }),
  uc3: Object.freeze({
    duration: "12.542",
    en: Object.freeze([
      cue("3.8-6.0", "salon", "Salon Mia, good morning!"),
      cue("6.05-10.1", "hermes/phone", "Hi, I'm Hermes, an AI assistant calling for Mara."),
      cue("10.15-12.5", "salon", "Friday at ten. Booked."),
    ]),
    de: Object.freeze([
      cue("3.8-6.0", "salon", "Salon Mia, guten Morgen!"),
      cue("6.05-10.1", "hermes/phone", "Hallo, ich bin Hermes, ein KI-Assistent, und rufe für Mara an."),
      cue("10.15-12.5", "salon", "Freitag um zehn. Gebucht."),
    ]),
  }),
  uc4: Object.freeze({
    duration: "7.5",
    en: Object.freeze([cue("0.6-4.8", "hermes", "While you were in the meeting: three calls, all handled.")]),
    de: Object.freeze([cue("0.6-4.8", "hermes", "Während deines Meetings: drei Anrufe, alles erledigt.")]),
  }),
});

export const clipDuration = (clip) => Number(VOICE_SCRIPT[clip].duration);

export const voiceAudioFile = (clip, lang) => `${clip}-${lang}.m4a`;
export const voiceCaptionFile = (clip, lang) => `${clip}-${lang}.vtt`;

export function voiceFilesFor(clip) {
  return VOICE_LANGS.flatMap((lang) => [voiceAudioFile(clip, lang), voiceCaptionFile(clip, lang)]);
}

export function voiceCharacters() {
  return Object.values(VOICE_SCRIPT).reduce(
    (sum, clip) => sum + VOICE_LANGS.reduce((inner, lang) => inner + clip[lang].reduce((chars, line) => chars + line.text.length, 0), 0),
    0,
  );
}

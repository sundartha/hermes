export const AUDIO_TAGS = Object.freeze(["calm", "thoughtful", "warmly", "softly", "gently", "patient"]);
export const AUDIO_TAG_LISTE = AUDIO_TAGS.join(", ");

export const KLAMMER_GRUPPE = /\s*\[[^\]\n]*\]/g;

export const entferneKlammern = (text) => String(text ?? "").replace(KLAMMER_GRUPPE, "").trim();

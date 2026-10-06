import { LOCALES } from "../i18n/locales.js";

const STT_LOCALE_BY_VOICE_PROFILE = Object.freeze(
  Object.fromEntries(
    Object.values(LOCALES).map((locale) => [locale.voiceProfile, locale.sttLocale]),
  ),
);

export function sttLocaleForVoiceProfile(voiceProfile) {
  const locale = STT_LOCALE_BY_VOICE_PROFILE[voiceProfile];
  if (!locale) throw new Error(`unbekanntes voiceProfile: ${voiceProfile}`);
  return locale;
}

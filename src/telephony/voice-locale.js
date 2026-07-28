// Bruecke logisches Voice-Profil -> BCP-47-Sprach-Locale. Bis P9 trug JEDER Renderer
// das Locale ein zweites Mal in seiner eigenen Voice-Tabelle - zwei Wahrheiten fuer
// dieselbe Sprache (das Locale-Buendel und die Adapter-Tabelle konnten auseinander-
// laufen, ohne dass ein Test das sieht). Der Core reicht dem Adapter nur den logischen
// Profilnamen; das hier ist die EINE Bruecke zurueck auf das Buendel (i18n/locales.js).
// Telnyx wie Twilio nutzen DENSELBEN Wert fuer das Say-TTS-Attribut und die
// Gather-STT-Locale - deshalb genuegt sttLocale (volles BCP-47, R9).
// Rein: kein IO, kein config-Import.
import { LOCALES } from "../i18n/locales.js";

const STT_LOCALE_BY_VOICE_PROFILE = Object.freeze(
  Object.fromEntries(
    Object.values(LOCALES).map((locale) => [locale.voiceProfile, locale.sttLocale]),
  ),
);

// Fail-closed wie voiceAttrs in beiden Renderern: ein Profil ohne Buendel-Eintrag ist ein
// Programmierfehler, kein Betriebszustand. KEIN stiller de-DE-Fallback - der wuerde
// deutsche Spracherkennung auf einen franzoesischen Anruf legen (R9-Wurzel).
export function sttLocaleForVoiceProfile(voiceProfile) {
  const locale = STT_LOCALE_BY_VOICE_PROFILE[voiceProfile];
  if (!locale) throw new Error(`unbekanntes voiceProfile: ${voiceProfile}`);
  return locale;
}

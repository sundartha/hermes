const SPOKEN_STEMS = [
  "fuer", "gespraech", "moeglich", "koennen", "spaeter",
  "wiederhoer", "natuerlich", "naechst", "hoefl",
];

const PROMPT_STEMS = [
  "persoenlich", "saetze", "hoechstens", "aeusserung", "gegenueber",
  "erwuenscht", "woertlich", "knuepfe", "vollstaendig", "klaeren",
  "haengen", "eroeffnet", "erhaelt", "loesen", "unverstaendlich",
  "zurueck", "gueltig", "faehigkeit", "rueckfrage", "wuensch",
];

export const SPOKEN_TRANSLITERATION_STEMS = new RegExp(SPOKEN_STEMS.join("|"), "i");
export const TRANSLITERATION_STEMS = new RegExp(
  [...SPOKEN_STEMS, ...PROMPT_STEMS].join("|"),
  "i",
);

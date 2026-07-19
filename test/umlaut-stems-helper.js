// EINE Quelle (G5) fuer die Denylist bekannter ASCII-Ersatzschreibungen deutscher
// Umlaute. Zwei Konsumenten mit unterschiedlichem Gegenstand:
//   - de-umlaut-orthography (P1): die GESPROCHENEN DE-Locale-Strings
//   - cq-p5-prompt-redesign (P5): System-Prompt + Tool-Descriptions
// Wortstamm-Denylist statt generischer /ue|oe|ae/-Regel: sonst schlagen legitime
// Wortfolgen falsch an ("neue", "Poesie", "zuerst", "Steuer", "Israel").
// Die P5-Ergaenzung steht GETRENNT, damit ein falsch-positiver Stamm chirurgisch
// entfernt werden kann, ohne den P1-Bestand zu beruehren.

// P1-Bestand - Wert unveraendert aus de-umlaut-orthography uebernommen.
const SPOKEN_STEMS = [
  "fuer", "gespraech", "moeglich", "koennen", "spaeter",
  "wiederhoer", "natuerlich", "naechst", "hoefl",
];

// P5-Ergaenzung: Staemme, die im Prompt-Geruest vorkamen.
const PROMPT_STEMS = [
  "persoenlich", "saetze", "hoechstens", "aeusserung", "gegenueber",
  "erwuenscht", "woertlich", "knuepfe", "vollstaendig", "klaeren",
  "haengen", "eroeffnet", "erhaelt", "loesen", "unverstaendlich",
  "zurueck", "gueltig", "faehigkeit", "rueckfrage", "wuensch",
];

// Nur die gesprochenen Strings (P1-Semantik, byte-gleiches Verhalten wie zuvor).
export const SPOKEN_TRANSLITERATION_STEMS = new RegExp(SPOKEN_STEMS.join("|"), "i");
// Vereinigung - fuer Prompt-/Tool-Text (P5).
export const TRANSLITERATION_STEMS = new RegExp(
  [...SPOKEN_STEMS, ...PROMPT_STEMS].join("|"),
  "i",
);

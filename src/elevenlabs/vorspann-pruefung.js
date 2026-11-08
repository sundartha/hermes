export const VORSPANN_TTS_FRIST_MS = 5000;

export const VORSPANN_MIN_BYTES_JE_ZEICHEN = 100;

export const VORSPANN_RUECKFALL = Object.freeze({
  KEINE_CALL_CONTROL_APP: "keine_call_control_app",
  EROEFFNUNG: "eroeffnung",
  TTS_QUOTE: "tts_quote",
  TTS_FEHLER: "tts_fehler",
  TTS_UNVOLLSTAENDIG: "tts_unvollstaendig",
  TTS_FRIST: "tts_frist",
  TTS_UNPLAUSIBEL: "tts_unplausibel",
});

export function eroeffnungRueckfall({ text, pflichtsatz }) {
  const beginntMitPflichtsatz = Boolean(text) && Boolean(pflichtsatz) && text.startsWith(pflichtsatz);
  return beginntMitPflichtsatz ? null : VORSPANN_RUECKFALL.EROEFFNUNG;
}

export function audioRueckfall({ audio, zeichen }) {
  if (!audio.complete) return VORSPANN_RUECKFALL.TTS_UNVOLLSTAENDIG;
  const zuKurz = audio.bytes.length < VORSPANN_MIN_BYTES_JE_ZEICHEN * zeichen;
  return zuKurz ? VORSPANN_RUECKFALL.TTS_UNPLAUSIBEL : null;
}

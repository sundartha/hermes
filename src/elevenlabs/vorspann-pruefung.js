export const VORSPANN_TTS_FRIST_MS = 5000;

export const VORSPANN_MIN_BYTES_JE_ZEICHEN = 100;

export const VORSPANN_ABLAGE_TTL_MS = 120_000;

export const VORSPANN_RUECKFALL = Object.freeze({
  KEINE_CALL_CONTROL_APP: "keine_call_control_app",
  EROEFFNUNG: "eroeffnung",
  TTS_QUOTE: "tts_quote",
  TTS_FEHLER: "tts_fehler",
  TTS_UNVOLLSTAENDIG: "tts_unvollstaendig",
  TTS_FRIST: "tts_frist",
  TTS_UNPLAUSIBEL: "tts_unplausibel",
});

export const VORSPANN_WAHL_GRUND = Object.freeze({
  ABGEBROCHEN: "abgebrochen_vor_wahl",
  GESPERRT: "gesperrt_vor_wahl",
  NICHT_ABGESPIELT: "vorspann_nicht_abgespielt",
  EL_FEHLER: "el_fehler",
});

export function eroeffnungRueckfall({ text, pflichtsatz }) {
  if (!pflichtsatz || !text.startsWith(pflichtsatz)) return VORSPANN_RUECKFALL.EROEFFNUNG;
  return null;
}

export function audioRueckfall({ audio, zeichen }) {
  if (!audio.complete) return VORSPANN_RUECKFALL.TTS_UNVOLLSTAENDIG;
  if (audio.bytes.length < VORSPANN_MIN_BYTES_JE_ZEICHEN * zeichen) return VORSPANN_RUECKFALL.TTS_UNPLAUSIBEL;
  return null;
}

export function wahlSperrGrund({ aktiv, gesperrt }) {
  if (!aktiv) return VORSPANN_WAHL_GRUND.ABGEBROCHEN;
  if (gesperrt) return VORSPANN_WAHL_GRUND.GESPERRT;
  return null;
}

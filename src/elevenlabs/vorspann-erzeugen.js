import { ergebnisOderNull } from "../telephony/ergebnis-oder-null.ts";
import {
  VORSPANN_RUECKFALL,
  VORSPANN_TTS_FRIST_MS,
  audioRueckfall,
  eroeffnungRueckfall,
} from "./vorspann-pruefung.js";

const LOG_TAG = "[el-vorspann]";

export const NICHT_ABGESPIELT_URSACHE = Object.freeze({
  START_ABGELEHNT: "start_abgelehnt",
  KEIN_ENDE_EREIGNIS: "kein_ende_ereignis",
});

const STATUS_ZEICHEN_UNGUELTIG = /[^A-Za-z0-9_.:-]/g;
const STATUS_LAENGE_MAX = 48;

export const statusUrsache = (status) =>
  `status_${String(status ?? "null").replace(STATUS_ZEICHEN_UNGUELTIG, "_").slice(0, STATUS_LAENGE_MAX)}`;

export function meldeVorspannRueckfall({ callId, grund, ursache }) {
  console.log(`${LOG_TAG} rueckfall grund=${grund} call=${callId}${ursache ? ` ursache=${ursache}` : ""}`);
}

export function meldeVorspannMessung({ callId, messung, bezug, ms }) {
  console.log(`${LOG_TAG} ${messung} ${bezug}=${ms} call=${callId}`);
}

export function meldeVorspannAbgespielt(callId) {
  console.log(`${LOG_TAG} offenlegung_abgespielt call=${callId}`);
}

export function meldeVorspannBereit(callId) {
  console.log(`${LOG_TAG} bereit call=${callId}`);
}

const rueckfall = (grund) => ({ rueckfall: grund });

async function synthetisiere({ synthese, text, voiceId }) {
  const result = await synthese(text, voiceId);
  if (result.quotaErschoepft) return rueckfall(VORSPANN_RUECKFALL.TTS_QUOTE);
  if (!result.ok) return rueckfall(VORSPANN_RUECKFALL.TTS_FEHLER);
  const audio = await result.audio;
  const grund = audioRueckfall({ audio, zeichen: text.length });
  if (grund) return rueckfall(grund);
  return { text, audio: { bytes: audio.bytes, contentType: result.contentType } };
}

export async function erzeugeVorspann({ eroeffnung, synthese, fristMs = VORSPANN_TTS_FRIST_MS }) {
  const { text, pflichtsatz, voiceId } = eroeffnung;
  const eroeffnungsGrund = eroeffnungRueckfall({ text, pflichtsatz });
  if (eroeffnungsGrund) return rueckfall(eroeffnungsGrund);
  if (!voiceId) return rueckfall(VORSPANN_RUECKFALL.TTS_FEHLER);
  const laufendeSynthese = synthetisiere({ synthese, text, voiceId }).catch(() =>
    rueckfall(VORSPANN_RUECKFALL.TTS_FEHLER),
  );
  const ergebnis = await ergebnisOderNull(laufendeSynthese, fristMs);
  return ergebnis ?? rueckfall(VORSPANN_RUECKFALL.TTS_FRIST);
}

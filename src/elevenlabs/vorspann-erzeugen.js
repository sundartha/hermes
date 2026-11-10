import { ergebnisOderNull } from "../telephony/ergebnis-oder-null.js";
import {
  VORSPANN_RUECKFALL,
  VORSPANN_TTS_FRIST_MS,
  audioRueckfall,
  eroeffnungRueckfall,
} from "./vorspann-pruefung.js";

const LOG_TAG = "[el-vorspann]";

export function vorspannInitInhalt(inhalt, gesagt) {
  if (!gesagt) return inhalt;
  const { agent } = inhalt.conversation_config_override;
  return {
    dynamic_variables: { ...inhalt.dynamic_variables, eroeffnung_gesagt: gesagt },
    conversation_config_override: { ...inhalt.conversation_config_override, agent: { ...agent, first_message: "" } },
  };
}

export function meldeVorspannRueckfall({ callId, grund }) {
  console.log(`${LOG_TAG} rueckfall grund=${grund} call=${callId}`);
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

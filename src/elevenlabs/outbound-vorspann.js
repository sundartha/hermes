import { ergebnisOderNull } from "../telephony/ergebnis-oder-null.js";
import { eroeffnungFuerAnruf } from "./outbound.js";
import {
  VORSPANN_RUECKFALL,
  VORSPANN_TTS_FRIST_MS,
  audioRueckfall,
  eroeffnungRueckfall,
} from "./vorspann-pruefung.js";

const LOG_TAG = "[el-vorspann]";

export function meldeVorspannRueckfall({ callId, grund }) {
  console.log(`${LOG_TAG} rueckfall grund=${grund} call=${callId}`);
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

export function makeVorspannErzeuger({ config, store, synthese, eroeffnung = eroeffnungFuerAnruf }) {
  return async function erzeugeVorspann(call) {
    const { text, pflichtsatz, voiceId } = eroeffnung({ store, config, call });
    const eroeffnungsGrund = eroeffnungRueckfall({ text, pflichtsatz });
    if (eroeffnungsGrund) return rueckfall(eroeffnungsGrund);
    if (!voiceId) return rueckfall(VORSPANN_RUECKFALL.TTS_FEHLER);
    const laufendeSynthese = synthetisiere({ synthese, text, voiceId }).catch(() =>
      rueckfall(VORSPANN_RUECKFALL.TTS_FEHLER),
    );
    const ergebnis = await ergebnisOderNull(laufendeSynthese, VORSPANN_TTS_FRIST_MS);
    return ergebnis ?? rueckfall(VORSPANN_RUECKFALL.TTS_FRIST);
  };
}

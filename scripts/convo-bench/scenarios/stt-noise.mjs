// Szenario "stt-noise" (Spec §9): Basis friseur-voll + verrauschte STT-Erkennung auf
// der Callee-Seite (persona.mjs:applySttNoise transformiert den gesprochenen Text VOR
// dem POST an /voice/turn). Zusaetzlicher Check no_tool_loop_exhaustion, weil
// verrauschter Input das Modell eher in mehrfache Tool-Runden treiben kann.
import friseurVoll from "./friseur-voll.mjs";

export default {
  ...friseurVoll,
  id: "stt-noise",
  sttNoise: true,
  checks: [...friseurVoll.checks, "no_tool_loop_exhaustion"],
};

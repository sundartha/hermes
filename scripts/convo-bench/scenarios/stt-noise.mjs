import friseurVoll from "./friseur-voll.mjs";

export default {
  ...friseurVoll,
  id: "stt-noise",
  sttNoise: true,
  checks: [...friseurVoll.checks, "no_tool_loop_exhaustion"],
};

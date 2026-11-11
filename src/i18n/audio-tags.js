const KLAMMER_GRUPPE = /\[[^\]\n]*\]\s*/g;
const LEERRAUM_VOR_SATZZEICHEN = /\s+([.,!?;:])/g;

export const entferneKlammern = (text) =>
  String(text ?? "")
    .replace(KLAMMER_GRUPPE, "")
    .replace(LEERRAUM_VOR_SATZZEICHEN, "$1")
    .trim();

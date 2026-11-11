const KLAMMER_GRUPPE = /\s*\[[^\]\n]*\]/g;

export const entferneKlammern = (text) => String(text ?? "").replace(KLAMMER_GRUPPE, "").trim();

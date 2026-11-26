export const KLAMMER_GRUPPE = /\s*\[[^\]\n]*\]/g;

export const entferneKlammern = (text?: string | number | null): string => String(text ?? "").replace(KLAMMER_GRUPPE, "").trim();

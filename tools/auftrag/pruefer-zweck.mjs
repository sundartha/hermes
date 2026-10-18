import { kenntZweck, zweckBlock } from "./zweck.mjs";

export const PRUEFER_ZWECK = {
  STATUS: "pruefer/status",
  NICHT_GELAUFEN: "pruefer/nicht-gelaufen",
  SICHERHEIT: "pruefer/sicherheit",
  BESTAETIGT: "pruefer/blocker-bestaetigt",
  UMGEHUNG: "pruefer/umgehung",
  ISSUE: "pruefer/issue",
  ABSICHT: "pruefer/absicht",
};
export const KATALOG_PRAEFIX = "pruefer/katalog-";
const KATALOG_EINTRAG = /^([A-Z])\d{1,2}$/;
const ABSICHT_BELEG = "Absicht:";
const ROTE_ZUSTAENDE = new Set(["failure", "error"]);

function katalogZweck(id) {
  const abschnitt = KATALOG_EINTRAG.exec(id)?.[1];
  const zweck = `${KATALOG_PRAEFIX}${abschnitt}`;
  return abschnitt && kenntZweck(zweck) ? [zweck] : [];
}

export function befundZweck(befund) {
  if (befund.umgehung) return [PRUEFER_ZWECK.UMGEHUNG];
  if (befund.id === "" && befund.beleg?.startsWith(ABSICHT_BELEG)) return [PRUEFER_ZWECK.ABSICHT];
  return katalogZweck(befund.id ?? "");
}

export function statusZweck({ state, zweck }) {
  return ROTE_ZUSTAENDE.has(state) && zweck ? [PRUEFER_ZWECK.STATUS, zweck] : [];
}

export function zweckZeilen(ids) {
  return ids.flatMap(zweckBlock);
}

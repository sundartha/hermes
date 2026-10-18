import { zweckBlock } from "./zweck.mjs";

export const PRUEFER_ZWECK = {
  STATUS: "pruefer/status",
  NICHT_GELAUFEN: "pruefer/nicht-gelaufen",
  SICHERHEIT: "pruefer/sicherheit",
  BESTAETIGT: "pruefer/blocker-bestaetigt",
  UMGEHUNG: "pruefer/umgehung",
};
const ROTE_ZUSTAENDE = new Set(["failure", "error"]);

export function statusZweck({ state, zweck }) {
  return ROTE_ZUSTAENDE.has(state) && zweck ? [PRUEFER_ZWECK.STATUS, zweck] : [];
}

export function zweckZeilen(ids) {
  return ids.flatMap(zweckBlock);
}

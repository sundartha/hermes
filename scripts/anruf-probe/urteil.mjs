import { LOCALES } from "../../src/i18n/locales.js";

export const ANNAHME_GRENZE_S = 15;
export const DAUER_GRENZE_S = 60;
const STATUS_BEENDET = "completed";

function offenlegungStimmt({ sprache, auftraggeber, begruessung }) {
  const locale = Object.hasOwn(LOCALES, sprache) ? LOCALES[sprache] : undefined;
  if (locale === undefined) return false;
  return begruessung.trim().startsWith(locale.disclosure(auftraggeber));
}

function begruessungText(messung) {
  return typeof messung.begruessung === "string" ? messung.begruessung.trim() : "";
}

export function urteilen(messung) {
  if (messung === null || typeof messung !== "object") return { gruen: false, gerissen: ["messung"] };
  const gerissen = [];
  if (!(messung.annahmeSekunden <= ANNAHME_GRENZE_S)) gerissen.push("annahme");
  if (begruessungText(messung) === "") gerissen.push("begruessung");
  else if (!offenlegungStimmt(messung)) gerissen.push("offenlegung");
  if (!(messung.dauerSekunden <= DAUER_GRENZE_S)) gerissen.push("dauer");
  if (messung.status !== STATUS_BEENDET) gerissen.push("status");
  return { gruen: gerissen.length === 0, gerissen };
}

import { LOCALES } from "../../src/i18n/locales.js";

export const ANNAHME_GRENZE_S = 15;
export const DAUER_GRENZE_S = 60;
const STATUS_BEENDET = "completed";
const RICHTUNG_STANDARD = "ausgehend";
const SOLL_SAETZE = Object.freeze({
  ausgehend: (locale, { auftraggeber }) => [locale.disclosure(auftraggeber)],
  eingehend: (locale, { auftraggeber, vorname }) => [
    locale.inboundEroeffnung(auftraggeber),
    locale.inboundEroeffnungOwner(vorname),
  ],
});

function offenlegungStimmt(messung) {
  const locale = Object.hasOwn(LOCALES, messung.sprache) ? LOCALES[messung.sprache] : undefined;
  const richtung = messung.richtung ?? RICHTUNG_STANDARD;
  if (locale === undefined || !Object.hasOwn(SOLL_SAETZE, richtung)) return false;
  const text = messung.begruessung.trim();
  return SOLL_SAETZE[richtung](locale, messung).some((satz) => satz !== "" && text.startsWith(satz));
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

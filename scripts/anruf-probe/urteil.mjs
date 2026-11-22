import { LOCALES } from "../../src/i18n/locales.ts";

export const ANNAHME_GRENZE_S = 15;
export const DAUER_GRENZE_S = 60;
export const STILLSTAND_GRENZE_S = 20;
export const MINDESTDAUER_S = 20;
export const KLINGELN_GRENZE_S = 10;
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

function eroeffnungenZaehlen(messung) {
  const locale = Object.hasOwn(LOCALES, messung.sprache) ? LOCALES[messung.sprache] : undefined;
  const richtung = messung.richtung ?? RICHTUNG_STANDARD;
  if (locale === undefined || !Object.hasOwn(SOLL_SAETZE, richtung) || !Array.isArray(messung.gegenseite)) return 0;
  const saetze = SOLL_SAETZE[richtung](locale, messung).filter((satz) => satz !== "");
  return messung.gegenseite.reduce(
    (summe, zeile) => summe + saetze.reduce((teil, satz) => teil + zeile.split(satz).length - 1, 0),
    0,
  );
}

function begruessungText(messung) {
  return typeof messung.begruessung === "string" ? messung.begruessung.trim() : "";
}

function stimmeGerissen(messung) {
  if (!Object.hasOwn(messung, "stimmenAnzahl")) return [];
  const anzahl = messung.stimmenAnzahl;
  if (!Number.isInteger(anzahl) || anzahl < 1) return ["stimme_unklar"];
  return anzahl > 1 ? ["stimmwechsel"] : [];
}

function ergebnisGerissen(messung) {
  if (!Object.hasOwn(messung, "ergebnisVorgetragen")) return [];
  return messung.ergebnisVorgetragen === true ? [] : ["ergebnis_fehlt"];
}

function klingelnGerissen(messung) {
  if (!Object.hasOwn(messung, "klingelnSekunden")) return [];
  const sekunden = messung.klingelnSekunden;
  if (typeof sekunden !== "number" || !Number.isFinite(sekunden) || sekunden < 0) return ["klingeln_fehlt"];
  return sekunden > KLINGELN_GRENZE_S ? ["klingeln_zu_spaet"] : [];
}

function mindestdauerGerissen(messung) {
  return messung.dauerSekunden < MINDESTDAUER_S ? ["zu_kurz"] : [];
}

function antwortGerissen(messung) {
  return messung.begruessungAntwort === false ? ["keine_antwort"] : [];
}

export function urteilen(messung) {
  if (messung === null || typeof messung !== "object") return { gruen: false, gerissen: ["messung"] };
  const gerissen = [];
  if (!(messung.annahmeSekunden <= ANNAHME_GRENZE_S)) gerissen.push("annahme");
  if (begruessungText(messung) === "") gerissen.push("begruessung");
  else if (!offenlegungStimmt(messung)) gerissen.push("offenlegung");
  if (eroeffnungenZaehlen(messung) > 1) gerissen.push("eroeffnung_doppelt");
  if (!(messung.dauerSekunden <= DAUER_GRENZE_S)) gerissen.push("dauer");
  gerissen.push(...mindestdauerGerissen(messung));
  if (messung.stillstandSekunden > STILLSTAND_GRENZE_S) gerissen.push("stillstand");
  gerissen.push(...antwortGerissen(messung));
  gerissen.push(...stimmeGerissen(messung));
  gerissen.push(...ergebnisGerissen(messung));
  gerissen.push(...klingelnGerissen(messung));
  if (messung.status !== STATUS_BEENDET) gerissen.push("status");
  return { gruen: gerissen.length === 0, gerissen };
}

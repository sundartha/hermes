import { createHash } from "node:crypto";

import { GRUPPE } from "./gruppen.mjs";

export const MATRIX_HOECHSTENS = 256;
export const TESTDATEIEN_JE_ANTEIL = GRUPPE;
export const STUECK_MINDEST_MS = 1_200_000;
const HAELFTE = 2;
const ZWEI_STUECKE = 2;

export function anteile(testdateien) {
  return Math.max(1, Math.ceil(testdateien / TESTDATEIEN_JE_ANTEIL));
}

export function einheitName({ pruefung, datei, anteil, von, stueck = 1, stuecke = 1 }) {
  const mutanten = stuecke > 1 ? `, Mutanten ${stueck} von ${stuecke}` : "";
  return `${pruefung === 0 ? "" : `Umbau ${pruefung}: `}${datei} (Testdateien ${anteil} von ${von}${mutanten})`;
}

export function ortsschluessel({ start, end }) {
  return `${start.line}:${start.column}-${end.line}:${end.column}`;
}

export function nachOrt(mutanten) {
  const orte = new Map();
  for (const mutant of mutanten) orte.set(ortsschluessel(mutant.lage), [...(orte.get(ortsschluessel(mutant.lage)) ?? []), mutant]);
  return [...orte.values()];
}

export function einheitGewicht(mutanten, tests, dauern) {
  if (!dauern || Object.keys(dauern).length === 0) return undefined;
  const gewicht = gewichtung(dauern);
  return (1 + (mutanten?.length ?? 0)) * tests.reduce((summe, test) => summe + gewicht(test), 0);
}

export function teileEinheit(einheit, ziel) {
  const orte = einheit.mutanten ? nachOrt(einheit.mutanten) : [];
  const stuecke = Math.min(orte.length, Math.ceil(einheit.gewicht / ziel));
  if (stuecke < ZWEI_STUECKE) return [{ ...einheit, stueck: 1, stuecke: 1 }];
  const jeMutant = einheit.gewicht / (einheit.mutanten.length + 1);
  return Array.from({ length: stuecke }, (_leer, index) => {
    const mutanten = orte.slice(Math.floor((index * orte.length) / stuecke), Math.floor(((index + 1) * orte.length) / stuecke)).flat();
    const stueck = { ...einheit, mutanten, stueck: index + 1, stuecke, gewicht: jeMutant * (mutanten.length + 1) };
    return index === 0 ? { ...stueck, alleMutanten: einheit.mutanten } : stueck;
  });
}

export function stueckeln(einheiten, plaetze = MATRIX_HOECHSTENS) {
  if (!einheiten.every(({ gewicht }) => Number.isFinite(gewicht))) return einheiten.map((einheit) => ({ ...einheit, stueck: 1, stuecke: 1 }));
  const summe = einheiten.reduce((gesamt, { gewicht }) => gesamt + gewicht, 0);
  const ziel = Math.max(summe / plaetze, STUECK_MINDEST_MS);
  return einheiten.flatMap((einheit) => teileEinheit(einheit, ziel));
}

function reihum(einheiten, anzahl) {
  const teile = Array.from({ length: anzahl }, () => []);
  einheiten.forEach((einheit, index) => teile[index % anzahl].push(einheit));
  return teile;
}

function leichtester(teile, vorzuziehen) {
  return teile.reduce((bester, teil, index) => {
    const vorne = teile[bester];
    return teil.summe < vorne.summe || (teil.summe === vorne.summe && vorzuziehen(teil, vorne)) ? index : bester;
  }, 0);
}

function wenigerEintraege(teil, vorne) {
  return teil.eintraege.length < vorne.eintraege.length;
}

function ersterBleibt() {
  return false;
}

function nachLastVerteilt(schwerZuerst, anzahl, { gewicht, vorzuziehen }) {
  const teile = Array.from({ length: anzahl }, () => ({ summe: 0, eintraege: [] }));
  for (const eintrag of schwerZuerst) {
    const ziel = teile[leichtester(teile, vorzuziehen)];
    ziel.summe += gewicht(eintrag);
    ziel.eintraege.push(eintrag);
  }
  return teile.map(({ eintraege }) => eintraege);
}

function nachLast(einheiten, anzahl) {
  const schwerZuerst = einheiten.map((einheit, index) => ({ einheit, index })).sort((links, rechts) => rechts.einheit.gewicht - links.einheit.gewicht || links.index - rechts.index);
  const teile = nachLastVerteilt(schwerZuerst, anzahl, { gewicht: ({ einheit }) => einheit.gewicht, vorzuziehen: wenigerEintraege });
  return teile.map((eintraege) => eintraege.sort((links, rechts) => links.index - rechts.index).map(({ einheit }) => einheit));
}

export function aufteilen(einheiten) {
  const anzahl = Math.min(einheiten.length, MATRIX_HOECHSTENS);
  return einheiten.every(({ gewicht }) => Number.isFinite(gewicht)) ? nachLast(einheiten, anzahl) : reihum(einheiten, anzahl);
}

export function pruefsumme(teile, kopf) {
  return createHash("sha256").update(JSON.stringify({ kopf, teile })).digest("hex");
}

function mittlere(werte) {
  const sortiert = [...werte].sort((links, rechts) => links - rechts);
  return sortiert[Math.floor(sortiert.length / HAELFTE)];
}

export function gewichtung(dauern) {
  const mittel = mittlere(Object.values(dauern));
  return (test) => (Object.hasOwn(dauern, test) ? dauern[test] : mittel);
}

export function nachGewicht(alle, von, dauern) {
  const gewicht = gewichtung(dauern);
  const schwerZuerst = [...alle].sort((links, rechts) => gewicht(rechts) - gewicht(links) || (links < rechts ? -1 : 1));
  const teile = nachLastVerteilt(schwerZuerst, von, { gewicht, vorzuziehen: ersterBleibt });
  return new Map(teile.flatMap((tests, index) => tests.map((test) => [test, index])));
}

function anteilVon(alle, von, dauern) {
  if (!dauern || Object.keys(dauern).length === 0) return (_test, index) => index % von;
  const zuordnung = nachGewicht(alle, von, dauern);
  return (test) => zuordnung.get(test);
}

export function anteilig({ erste, alle, nachsichtig }, { anteil, von, dauern }) {
  const anteilsnummer = anteilVon(alle, von, dauern);
  const eigene = alle.filter((test, index) => anteilsnummer(test, index) === anteil - 1);
  return { erste: erste.filter((test) => eigene.includes(test)), alle: eigene, nachsichtig };
}

export function matrix(teile) {
  return teile.length === 0 ? [0] : teile.map((_teil, index) => index + 1);
}

export function teilnummer({ teil, teile }, anzahl) {
  const [nummer, erwartet] = [Number(teil), Number(teile)];
  if (erwartet !== anzahl) throw new Error(`der Plan hat ${anzahl} Teile, aufgerufen mit --teile ${teile}`);
  const gueltig = anzahl === 0 ? nummer === 0 : Number.isInteger(nummer) && nummer >= 1 && nummer <= anzahl;
  if (!gueltig) throw new Error(`Teil ${teil} gibt es im Plan mit ${anzahl} Teilen nicht`);
  return nummer;
}

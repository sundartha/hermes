import { istObjekt, istText, liste } from "./erkundung.mjs";

const REGEL = "Regel Teilliste: ";
const LISTEN = ["annahmen", "fehlendeSzenarien", "ownerAufgaben", "gemeinsameNamen"];
const KENNUNGSLISTEN = ["auftraege", "entfernt", "reihenfolge"];

const ERLAUBT = [...KENNUNGSLISTEN, ...LISTEN];

function formBefunde(teilliste) {
  return [
    ...Object.keys(teilliste).filter((feld) => !ERLAUBT.includes(feld)).map((feld) => `unbekannter Schlüssel ${feld}; erlaubt sind ${ERLAUBT.join(", ")}`),
    ...KENNUNGSLISTEN.filter((feld) => teilliste[feld] !== undefined && !Array.isArray(teilliste[feld])).map((feld) => `${feld} ist keine Liste`),
  ];
}

function doppelte(werte) {
  return [...new Set(werte.filter((wert, stelle) => werte.indexOf(wert) !== stelle))];
}

function alteDoppelte(bekannt, beruehrt, mitReihenfolge) {
  return doppelte(bekannt).filter((id) => mitReihenfolge || beruehrt.includes(id)).map((id) => `${id} steht mehrfach in der Schnittliste`);
}

function kennungsBefunde(bekannt, auftraege, entfernt) {
  const kennungen = auftraege.map(({ id }) => id);
  return [
    ...doppelte(kennungen).map((id) => `${id} steht mehrfach unter auftraege`),
    ...kennungen.filter((id) => entfernt.includes(id)).map((id) => `${id} steht unter auftraege und unter entfernt`),
    ...entfernt.filter((id) => !bekannt.includes(id)).map((id) => `entfernt nennt ${id}, das es in der Schnittliste nicht gibt`),
  ];
}

function ohneKennung(auftraege) {
  return auftraege.flatMap((auftrag, stelle) => (istObjekt(auftrag) && istText(auftrag.id) ? [] : [stelle + 1]));
}

function eingesetzt(alte, auftraege, entfernt) {
  const neu = new Map(auftraege.map((auftrag) => [auftrag.id, auftrag]));
  const bleibend = alte.filter(({ id }) => !entfernt.includes(id)).map((auftrag) => neu.get(auftrag.id) ?? auftrag);
  const bekannt = new Set(alte.map(({ id }) => id));
  return [...bleibend, ...auftraege.filter(({ id }) => !bekannt.has(id))];
}

function reihenfolgeBefunde(reihenfolge, auftraege) {
  if (reihenfolge === undefined) return [];
  const soll = auftraege.map(({ id }) => id).toSorted();
  const ist = reihenfolge.toSorted();
  return JSON.stringify(soll) === JSON.stringify(ist) ? [] : [`reihenfolge muss genau die Kennungen der neuen Liste nennen: ${soll.join(", ")}`];
}

function geordnet(auftraege, reihenfolge) {
  if (reihenfolge === undefined) return auftraege;
  return reihenfolge.map((id) => auftraege.find((auftrag) => auftrag.id === id));
}

export function setzeTeillisteEin(schnitt, teilliste) {
  if (!istObjekt(teilliste)) return { schnitt, befunde: [`${REGEL}teilliste ist kein Objekt`] };
  const form = formBefunde(teilliste);
  if (form.length > 0) return { schnitt, befunde: form.map((befund) => `${REGEL}${befund}`) };
  const auftraege = teilliste.auftraege ?? [];
  const entfernt = teilliste.entfernt ?? [];
  const alte = liste(schnitt.auftraege);
  const ohne = [
    ...ohneKennung(alte).map((stelle) => `Auftrag ${stelle} der Schnittliste hat keine id; schick die ganze Schnittliste unter schnitt`),
    ...ohneKennung(auftraege).map((stelle) => `Auftrag ${stelle} unter auftraege hat keine id`),
  ];
  if (ohne.length > 0) return { schnitt, befunde: ohne.map((befund) => `${REGEL}${befund}`) };
  const neue = eingesetzt(alte, auftraege, entfernt);
  const bekannt = alte.map(({ id }) => id);
  const beruehrt = [...auftraege.map(({ id }) => id), ...entfernt];
  const befunde = [...alteDoppelte(bekannt, beruehrt, teilliste.reihenfolge !== undefined), ...kennungsBefunde(bekannt, auftraege, entfernt), ...reihenfolgeBefunde(teilliste.reihenfolge, neue)];
  if (befunde.length > 0) return { schnitt, befunde: befunde.map((befund) => `${REGEL}${befund}`) };
  const listen = Object.fromEntries(LISTEN.filter((feld) => Object.hasOwn(teilliste, feld)).map((feld) => [feld, teilliste[feld]]));
  return { schnitt: { ...schnitt, ...listen, auftraege: geordnet(neue, teilliste.reihenfolge) }, befunde: [] };
}

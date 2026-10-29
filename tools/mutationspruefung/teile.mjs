import { createHash } from "node:crypto";

import { GRUPPE } from "./gruppen.mjs";

export const MATRIX_HOECHSTENS = 256;
export const TESTDATEIEN_JE_ANTEIL = GRUPPE;
const HAELFTE = 2;

export function anteile(testdateien) {
  return Math.max(1, Math.ceil(testdateien / TESTDATEIEN_JE_ANTEIL));
}

export function einheitName({ pruefung, datei, anteil, von }) {
  return `${pruefung === 0 ? "" : `Umbau ${pruefung}: `}${datei} (Testdateien ${anteil} von ${von})`;
}

export function aufteilen(einheiten) {
  const anzahl = Math.min(einheiten.length, MATRIX_HOECHSTENS);
  const teile = Array.from({ length: anzahl }, () => []);
  einheiten.forEach((einheit, index) => teile[index % anzahl].push(einheit));
  return teile;
}

export function pruefsumme(teile, kopf) {
  return createHash("sha256").update(JSON.stringify({ kopf, teile })).digest("hex");
}

function mittlere(werte) {
  const sortiert = [...werte].sort((links, rechts) => links - rechts);
  return sortiert[Math.floor(sortiert.length / HAELFTE)];
}

function nachGewicht(alle, von, dauern) {
  const mittel = mittlere(Object.values(dauern));
  const gewicht = (test) => (Object.hasOwn(dauern, test) ? dauern[test] : mittel);
  const summen = Array.from({ length: von }, () => 0);
  const zuordnung = new Map();
  const schwerZuerst = [...alle].sort((links, rechts) => gewicht(rechts) - gewicht(links) || (links < rechts ? -1 : 1));
  for (const test of schwerZuerst) {
    const leichtester = summen.indexOf(Math.min(...summen));
    summen[leichtester] += gewicht(test);
    zuordnung.set(test, leichtester);
  }
  return zuordnung;
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
